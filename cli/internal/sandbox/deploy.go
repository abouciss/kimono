package sandbox

import (
	"encoding/json"
	"errors"
	"net/http"
	"path"
	"strconv"
	"strings"
)

/*
 * Hosting a repository as it is: no agent, no chat. The sandbox sits on the
 * repository's own branch; a deploy brings it to what Kimono Git has and runs
 * the site the way the repository says (kimono.json), or the way it plainly
 * is (an index.html, a package.json with a start script).
 */

// deployScript fast-forwards the checkout and says what is there to run.
const deployScript = `set -e
branch=$1
cd /workspace
git fetch --quiet --prune origin
if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  git merge --quiet --ff-only "origin/$branch" >/dev/null 2>&1 || { echo diverged; exit 0; }
fi
echo "commit $(git rev-parse HEAD 2>/dev/null || true)"
# What builds it, if anything: the repository's own word, else its build script.
build=$(jq -r 'if (.build | type) == "string" then .build else "" end' kimono.json 2>/dev/null | tr '\n' ' ' | head -c 2000 || true)
if [ -z "$(printf '%s' "$build" | tr -d '[:space:]')" ]; then
  build=
  if ! { [ -f kimono.json ] && jq -e 'has("build")' kimono.json >/dev/null 2>&1; } && [ -f package.json ] && jq -e '.scripts.build' package.json >/dev/null 2>&1; then build=auto; fi
fi
echo "build $build"`

// detectScript says how what is in a folder runs: the checkout, or what a
// build left. Built output comes first, so a built app isn't served as its source.
const detectScript = `cd "$1" || { echo none; exit 0; }
if [ -f kimono.json ] && jq -e 'has("static") or has("command")' kimono.json >/dev/null 2>&1; then printf 'config '; head -c 4000 kimono.json | tr -d '\n'; echo; exit 0; fi
if [ "$2" = built ]; then order="dist build out _site public site docs ."; else order=". public dist build site docs _site out"; fi
for d in $order; do
  if [ -f "$d/index.html" ]; then echo "static $d"; exit 0; fi
done
if [ -f package.json ] && jq -e '.scripts.start' package.json >/dev/null 2>&1; then echo npm; exit 0; fi
echo none`

// staticServer serves a folder's files and nothing whose path has a dotfile in
// it: a site served from the repository's root must not hand out .git or .kimono.
const staticServer = `import http.server, sys
class Site(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if any(part.startswith(".") for part in self.path.split("?")[0].split("#")[0].split("/") if part):
            self.send_error(404)
            return None
        return super().send_head()
http.server.ThreadingHTTPServer(("0.0.0.0", int(sys.argv[1])), lambda *a: Site(*a, directory=sys.argv[2])).serve_forever()`

// siteConfig is a repository's kimono.json: a folder of plain files, or a
// command that serves on $PORT.
type siteConfig struct {
	Static  string          `json:"static"`
	Command json.RawMessage `json:"command"`
	Port    int             `json:"port"`
	Kind    string          `json:"kind"`
	// Build is read by deployScript: a shell line run where the web is reachable, before the site starts.
	Build string `json:"build"`
}

const sitePort = 8080

func staticSite(base, dir string) (serveState, bool) {
	clean := path.Clean("/" + strings.TrimSpace(dir))
	if strings.Contains(dir, "\x00") {
		return serveState{}, false
	}
	for _, part := range strings.Split(strings.Trim(clean, "/"), "/") {
		if strings.HasPrefix(part, ".") {
			return serveState{}, false
		}
	}
	return serveState{Port: sitePort, Command: []string{"python3", "-c", staticServer, strconv.Itoa(sitePort), base + strings.TrimSuffix(clean, "/")}, Kind: "Static site", Cwd: base}, true
}

// sitePlan reads what deployScript found into how the site runs.
func sitePlan(found, base string) (serveState, error) {
	how, rest, _ := strings.Cut(strings.TrimSpace(found), " ")
	unknown := problem(422, "Kimono couldn't tell how to run this repository. Add an index.html, or a kimono.json that says how.")
	switch how {
	case "static":
		if serve, ok := staticSite(base, rest); ok {
			return serve, nil
		}
	case "npm":
		return serveState{Port: sitePort, Command: []string{"npm", "start"}, Kind: "Node server", Cwd: base}, nil
	case "config":
		var config siteConfig
		if json.Unmarshal([]byte(rest), &config) != nil {
			return serveState{}, problem(422, "This repository's kimono.json isn't valid JSON.")
		}
		if config.Static != "" {
			if serve, ok := staticSite(base, config.Static); ok {
				return serve, nil
			}
			return serveState{}, problem(422, "kimono.json's static folder isn't one Kimono can serve.")
		}
		var command []string
		var line string
		if json.Unmarshal(config.Command, &command) != nil && json.Unmarshal(config.Command, &line) == nil && strings.TrimSpace(line) != "" {
			command = []string{"sh", "-c", line}
		}
		if len(command) == 0 || len(command) > 64 {
			return serveState{}, problem(422, `kimono.json needs "static": "<folder>" or "command": ["node", "server.js"].`)
		}
		port := config.Port
		if port < 1 || port > 65535 {
			port = sitePort
		}
		return serveState{Port: port, Command: command, Kind: config.Kind, Cwd: base}, nil
	}
	return serveState{}, unknown
}

// handleDeploy brings a hosted repository up to date and (re)starts its site.
func (s *Server) handleDeploy(w http.ResponseWriter, r *http.Request, id string) error {
	space, err := s.remembered(id)
	if err != nil {
		return err
	}
	space.mu.Lock()
	repo, busy := space.repo, space.busy
	space.mu.Unlock()
	if repo.URL == "" {
		return problem(400, "This chat isn't on a repository.")
	}
	if busy {
		return problem(409, "It's being worked on right now. Try again when that's done.")
	}
	if _, err := s.running(r.Context(), id); err != nil {
		return err
	}
	space.op.Lock()
	out, err := s.exec(r.Context(), space, nil, nil, "bash", "-c", deployScript, "deploy", repo.Branch)
	space.op.Unlock()
	if err != nil {
		s.cfg.Logf("deploy %s: %v", id, err)
		return problem(502, "Kimono couldn't get the repository's latest. Try again in a moment.")
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if lines[0] == "diverged" {
		return problem(409, "This copy has changes of its own, so it can't take the repository's latest.")
	}
	commit := strings.TrimSpace(strings.TrimPrefix(lines[0], "commit"))
	// A repository that builds is built away from its sandbox, where the web is reachable, and served from what that left.
	base, where := "/workspace", "source"
	if command := strings.TrimSpace(strings.TrimPrefix(lines[len(lines)-1], "build")); command != "" {
		if err := s.build(r.Context(), id, command); err != nil {
			var refused *apiProblem
			if !errors.As(err, &refused) {
				s.cfg.Logf("build %s: %v", id, err)
				return problem(502, "The site couldn't be built. Try again in a moment.")
			}
			return err
		}
		base, where = builtDir, "built"
	}
	found, err := s.exec(r.Context(), space, nil, nil, "bash", "-c", detectScript, "detect", base, where)
	if err != nil {
		return problem(502, "Kimono couldn't read the repository. Try again in a moment.")
	}
	serve, err := sitePlan(string(found), base)
	if err != nil {
		return err
	}
	before := s.previewCopy(id)
	same := before != nil && !before.Stopped && before.Port == serve.Port && equalArgs(before.Args, serve.Command)
	lock := s.serveLock(id)
	lock.Lock()
	// Plain files are served as they change; anything else starts again on the new code.
	if !(same && serve.Kind == "Static site" && s.portAnswers(r.Context(), id, serve.Port)) {
		// A site its owner stopped starts again with a deploy: they asked for it, or pushed to it.
		err = s.startServe(r.Context(), id, &preview{Port: serve.Port, Args: serve.Command, Kind: serve.Kind, Dir: serve.Cwd})
	}
	lock.Unlock()
	if err != nil {
		s.cfg.Logf("deploy %s: start: %v", id, err)
		return problem(502, "The site didn't start. Its log says why.")
	}
	// The link is named for the repository, not for a branch called main.
	p, _ := s.setPreview(id, serve, repo.Name)
	s.mu.Lock()
	body := s.previewBody(p)
	s.mu.Unlock()
	body["commit"] = commit
	writeJSON(w, 200, body)
	return nil
}
