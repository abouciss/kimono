package sandbox

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
 * Building a hosted repository. Sandboxes never reach the web, so installing
 * and building happen somewhere else: a throwaway container on a network of
 * its own that reaches the public internet and nothing private — not the
 * node, the LAN, the mesh or other containers. It gets the repository's
 * tracked files and nothing more: no Kimono Git token, no model key, none of
 * Kimono's own files (.kimono). What it leaves is copied into the site's
 * sandbox, which stays offline, and served from there.
 */

const (
	buildForwardChain = "KIMONO-BUILD"
	buildInputChain   = "KIMONO-BUILD-IN"
	// builtDir is where a build's result sits in the site's sandbox: under
	// .kimono, so it is never committed and never mirrored to Drive.
	builtDir     = "/workspace/.kimono/built"
	buildTimeout = 10 * time.Minute
)

// privateNets are where a build must never reach: private, mesh (CGNAT),
// link-local (cloud metadata), loopback and the reserved ranges.
var privateNets = []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4", "240.0.0.0/4"}

// planBuildFirewall lets the build network out to public addresses only, and
// to nothing on the node itself.
func planBuildFirewall(n sandboxNet) (firewallPlan, error) {
	var plan firewallPlan
	if n.Subnet4 == "" {
		return plan, errors.New("the build network has no IPv4 subnet")
	}
	reject := []string{"-j", "REJECT", "--reject-with", "icmp-port-unreachable"}
	forward := [][]string{{"-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"}}
	for _, net := range privateNets {
		forward = append(forward, append([]string{"-d", net}, reject...))
	}
	forward = append(forward, []string{"-j", "RETURN"})
	input := [][]string{
		{"-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"},
		append([]string{}, reject...),
	}
	plan.Chains = []fwChain{{Bin: "iptables", Name: buildForwardChain, Rules: forward}, {Bin: "iptables", Name: buildInputChain, Rules: input}}
	plan.Jumps = []fwRule{
		{Bin: "iptables", Chain: "DOCKER-USER", Spec: []string{"-s", n.Subnet4, "-j", buildForwardChain}},
		{Bin: "iptables", Chain: "INPUT", Spec: []string{"-s", n.Subnet4, "-j", buildInputChain}},
	}
	return plan, nil
}

var (
	buildNetMu    sync.Mutex
	buildFirewall = map[*Server]*firewallPlan{}
)

func (s *Server) buildNetworkName() string { return s.cfg.Network + "-builds" }

// buildNetwork makes sure the build network exists with its firewall in
// place, and refuses to build without it (except on Docker Desktop, in
// development, where no firewall is applied at all).
func (s *Server) buildNetwork(ctx context.Context) (string, error) {
	buildNetMu.Lock()
	defer buildNetMu.Unlock()
	name := s.buildNetworkName()
	n, err := s.docker.inspectNetwork(ctx, name)
	if err != nil || n.Subnet4 == "" {
		// IPv4 only: the rules above are, and a build has no need of more.
		if _, err := s.docker.run(ctx, nil, "network", "create", "--driver", "bridge", "--label", "kimono.build=network",
			"--ipv6=false", "-o", "com.docker.network.bridge.enable_icc=false", name); err != nil {
			return "", fmt.Errorf("create the build network: %w", err)
		}
		if n, err = s.docker.inspectNetwork(ctx, name); err != nil {
			return "", err
		}
	}
	if dockerDesktop {
		return name, nil
	}
	if _, err := exec.LookPath("iptables"); err != nil {
		return "", problem(503, "This node can't build sites: it needs iptables to keep builds off the house network.")
	}
	run := s.fwRun
	if run == nil {
		run = execFirewall
	}
	if plan := buildFirewall[s]; plan != nil {
		return name, plan.ensureJumps(ctx, run)
	}
	plan, err := planBuildFirewall(n)
	if err != nil {
		return "", err
	}
	if err := plan.apply(ctx, run); err != nil {
		return "", fmt.Errorf("put the build firewall in place: %w", err)
	}
	buildFirewall[s] = &plan
	s.cfg.Logf("build firewall in place for %s (public internet only)", n.Subnet4)
	return name, nil
}

func buildName(id string) string { return "kimono-build-" + id }

// defaultBuild is what a repository with a build script and no word of its
// own gets: its lockfile's package manager installs, then the script runs.
const defaultBuild = `if [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile && corepack pnpm run build
elif [ -f yarn.lock ]; then corepack yarn install --immutable && corepack yarn run build
elif [ -f package-lock.json ]; then npm ci && npm run build
else npm install && npm run build; fi`

const buildPrepare = `set -e
mkdir -p /workspace/src /workspace/home
cd /workspace/src
find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +`

const builtReceive = `set -e
mkdir -p /workspace/.kimono
rm -rf /workspace/.kimono/built.new
mkdir /workspace/.kimono/built.new
tar -x -C /workspace/.kimono/built.new`

const builtSwap = `set -e
cd /workspace/.kimono
rm -rf built.old
[ -d built ] && mv built built.old
mv built.new built
rm -rf built.old`

// pipe streams one container command's output into another's input.
func (s *Server) pipe(ctx context.Context, from, to []string) error {
	reader, writer := io.Pipe()
	sent := make(chan error, 1)
	go func() {
		err := s.docker.stream(ctx, nil, writer, from...)
		writer.CloseWithError(err)
		sent <- err
	}()
	_, err := s.docker.run(ctx, reader, to...)
	reader.CloseWithError(err)
	if sendErr := <-sent; sendErr != nil {
		return sendErr
	}
	return err
}

// build runs the repository's build away from its sandbox and brings the
// result back to builtDir. On failure it answers with the end of the build's
// output, and the site that is up stays as it is.
func (s *Server) build(ctx context.Context, id, command string) error {
	network, err := s.buildNetwork(ctx)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, buildTimeout+2*time.Minute)
	defer cancel()
	sandboxName, name := containerName(id), buildName(id)
	_, _ = s.docker.run(ctx, nil, "rm", "-f", name)
	// The volume keeps node_modules and the package cache between builds; the container never outlives one.
	args := []string{"run", "-d", "--name", name, "--label", "kimono.build=" + id,
		"--hostname", "build", "--network", network, "--dns", "1.1.1.1", "--dns", "8.8.8.8",
		"--pids-limit", strconv.Itoa(s.cfg.Pids), "--init", "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
		"--user", "agent", "--workdir", "/workspace", "-v", name + ":/workspace"}
	args = append(args, s.limitsNow().dockerArgs()...)
	if s.runtime == "runsc" {
		args = append(args, "--runtime", "runsc")
	}
	args = append(args, s.cfg.Image, "sleep", strconv.Itoa(int((buildTimeout + 3*time.Minute).Seconds())))
	if _, err := s.docker.run(ctx, nil, args...); err != nil {
		return fmt.Errorf("start the build: %w", err)
	}
	defer func() {
		gone, done := context.WithTimeout(context.Background(), 20*time.Second)
		defer done()
		_, _ = s.docker.run(gone, nil, "rm", "-f", name)
	}()
	if _, err := s.docker.run(ctx, nil, "exec", name, "sh", "-c", buildPrepare); err != nil {
		return fmt.Errorf("ready the build: %w", err)
	}
	// Only what the repository tracks goes in: never .git, never Kimono's own files.
	if err := s.pipe(ctx,
		[]string{"exec", "-u", "agent", "-w", "/workspace", sandboxName, "git", "archive", "HEAD"},
		[]string{"exec", "-i", name, "tar", "-x", "-C", "/workspace/src"}); err != nil {
		return fmt.Errorf("hand the repository to the build: %w", err)
	}
	if command == "auto" {
		command = defaultBuild
	}
	script := `cd /workspace/src && timeout ` + strconv.Itoa(int(buildTimeout.Seconds())) + ` bash -c "$1" > /workspace/build.log 2>&1`
	if _, err := s.docker.run(ctx, nil, "exec", "-e", "HOME=/workspace/home", "-e", "CI=1", name, "bash", "-c", script, "build", command); err != nil {
		tail, _ := s.docker.run(ctx, nil, "exec", name, "tail", "-c", "1500", "/workspace/build.log")
		said := strings.TrimSpace(string(tail))
		var exit *execError
		if errors.As(err, &exit) && exit.code == 124 {
			said = "It took more than 10 minutes.\n" + said
		}
		return problem(422, strings.TrimSpace("The build failed.\n"+said))
	}
	if err := s.pipe(ctx,
		[]string{"exec", name, "tar", "-c", "-C", "/workspace/src", "."},
		[]string{"exec", "-i", "-u", "agent", sandboxName, "sh", "-c", builtReceive}); err != nil {
		return problem(507, "The built site didn't fit in its sandbox.")
	}
	if _, err := s.docker.run(ctx, nil, "exec", "-u", "agent", sandboxName, "sh", "-c", builtSwap); err != nil {
		return fmt.Errorf("put the built site in place: %w", err)
	}
	return nil
}

// removeBuild takes a site's build cache away with its sandbox.
func (s *Server) removeBuild(ctx context.Context, id string) {
	_, _ = s.docker.run(ctx, nil, "rm", "-f", buildName(id))
	_, _ = s.docker.run(ctx, nil, "volume", "rm", "-f", buildName(id))
}
