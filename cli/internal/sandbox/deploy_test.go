package sandbox

import "testing"

func TestSitePlan(t *testing.T) {
	static, err := sitePlan("static dist")
	if err != nil || static.Kind != "Static site" || static.Command[len(static.Command)-1] != "/workspace/dist" {
		t.Fatalf("static dist: %+v %v", static, err)
	}
	if root, err := sitePlan("static ."); err != nil || root.Command[len(root.Command)-1] != "/workspace" {
		t.Fatalf("static .: %+v %v", root, err)
	}
	if npm, err := sitePlan("npm"); err != nil || npm.Command[0] != "npm" {
		t.Fatalf("npm: %+v %v", npm, err)
	}
	config, err := sitePlan(`config {"command": "node server.js", "port": 3000, "kind": "Node API"}`)
	if err != nil || config.Port != 3000 || config.Command[0] != "sh" || config.Kind != "Node API" {
		t.Fatalf("config: %+v %v", config, err)
	}
	if list, err := sitePlan(`config {"command": ["node", "server.js"]}`); err != nil || list.Port != sitePort || len(list.Command) != 2 {
		t.Fatalf("config list: %+v %v", list, err)
	}
	for _, bad := range []string{"none", "", `config {"static": ".git"}`, `config {"static": "../.kimono/claude"}`, `config {}`, `config nope`} {
		if _, err := sitePlan(bad); err == nil {
			t.Fatalf("%q should be refused", bad)
		}
	}
	if up, err := sitePlan(`config {"static": "../../etc"}`); err != nil || up.Command[len(up.Command)-1] != "/workspace/etc" {
		t.Fatalf("a folder can't leave /workspace: %+v %v", up, err)
	}
}
