package sandbox

import (
	"encoding/json"
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
if [ -f kimono.json ]; then printf 'config '; head -c 4000 kimono.json | tr -d '\n'; echo; exit 0; fi
for d in . public dist build site docs _site out; do
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
}

const sitePort = 8080

func staticSite(dir string) (serveState, bool) {
	clean := path.Clean("/" + strings.TrimSpace(dir))
	if strings.Contains(dir, "\x00") {
		return serveState{}, false
	}
	for _, part := range strings.Split(strings.Trim(clean, "/"), "/") {
		if strings.HasPrefix(part, ".") {
			return serveState{}, false
		}
	}
	return serveState{Port: sitePort, Command: []string{"python3", "-c", staticServer, strconv.Itoa(sitePort), "/workspace" + strings.TrimSuffix(clean, "/")}, Kind: "Static site", Cwd: "/workspace"}, true
}

// sitePlan reads what deployScript found into how the site runs.
func sitePlan(found string) (serveState, error) {
	how, rest, _ := strings.Cut(strings.TrimSpace(found), " ")
	unknown := problem(422, "Kimono couldn't tell how to run this repository. Add an index.html, or a kimono.json that says how.")
	switch how {
	case "static":
		if serve, ok := staticSite(rest); ok {
			return serve, nil
		}
	case "npm":
		return serveState{Port: sitePort, Command: []string{"npm", "start"}, Kind: "Node server", Cwd: "/workspace"}, nil
	case "config":
		var config siteConfig
		if json.Unmarshal([]byte(rest), &config) != nil {
			return serveState{}, problem(422, "This repository's kimono.json isn't valid JSON.")
		}
		if config.Static != "" {
			if serve, ok := staticSite(config.Static); ok {
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
		return serveState{Port: port, Command: command, Kind: config.Kind, Cwd: "/workspace"}, nil
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
	serve, err := sitePlan(lines[len(lines)-1])
	if err != nil {
		return err
	}
	before := s.previewCopy(id)
	same := before != nil && !before.Stopped && before.Port == serve.Port && equalArgs(before.Args, serve.Command)
	lock := s.serveLock(id)
	lock.Lock()
	// Plain files are served as they change; anything else starts again on the new code.
	if !(same && serve.Kind == "Static site" && s.portAnswers(r.Context(), id, serve.Port)) {
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
