package sandbox

import "testing"

func TestSitePlan(t *testing.T) {
	static, err := sitePlan("static dist", "/workspace")
	if err != nil || static.Kind != "Static site" || static.Command[len(static.Command)-1] != "/workspace/dist" {
		t.Fatalf("static dist: %+v %v", static, err)
	}
	if root, err := sitePlan("static .", "/workspace"); err != nil || root.Command[len(root.Command)-1] != "/workspace" {
		t.Fatalf("static .: %+v %v", root, err)
	}
	if npm, err := sitePlan("npm", "/workspace"); err != nil || npm.Command[0] != "npm" {
		t.Fatalf("npm: %+v %v", npm, err)
	}
	config, err := sitePlan(`config {"command": "node server.js", "port": 3000, "kind": "Node API"}`, "/workspace")
	if err != nil || config.Port != 3000 || config.Command[0] != "sh" || config.Kind != "Node API" {
		t.Fatalf("config: %+v %v", config, err)
	}
	if list, err := sitePlan(`config {"command": ["node", "server.js"]}`, "/workspace"); err != nil || list.Port != sitePort || len(list.Command) != 2 {
		t.Fatalf("config list: %+v %v", list, err)
	}
	for _, bad := range []string{"none", "", `config {"static": ".git"}`, `config {"static": "../.kimono/claude"}`, `config {}`, `config nope`} {
		if _, err := sitePlan(bad, "/workspace"); err == nil {
			t.Fatalf("%q should be refused", bad)
		}
	}
	if built, err := sitePlan("static dist", builtDir); err != nil || built.Command[len(built.Command)-1] != builtDir+"/dist" || built.Cwd != builtDir {
		t.Fatalf("built: %+v %v", built, err)
	}
	plan, err := planBuildFirewall(sandboxNet{Subnet4: "172.30.0.0/16", Gateway4: "172.30.0.1"})
	if err != nil || len(plan.Jumps) != 2 || plan.Chains[1].Rules[1][1] != "REJECT" {
		t.Fatalf("build firewall: %+v %v", plan, err)
	}
	last := plan.Chains[0].Rules[len(plan.Chains[0].Rules)-1]
	if len(plan.Chains[0].Rules) != len(privateNets)+2 || last[1] != "RETURN" {
		t.Fatalf("a build reaches public addresses only: %+v", plan.Chains[0].Rules)
	}
	if up, err := sitePlan(`config {"static": "../../etc"}`, "/workspace"); err != nil || up.Command[len(up.Command)-1] != "/workspace/etc" {
		t.Fatalf("a folder can't leave /workspace: %+v %v", up, err)
	}
}
