package discord

import (
	"net/http"
	"slices"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

// TestRoutes pins the bot's HTTP surface. The frontend's paths did not move with
// the subjects, so a wrong Queue here reaches a worker nobody runs anymore (a
// timeout, not an error); the pickers must forward workspace_id as a Path param
// and the channel binding the tournament as data["id"], because that is what
// each handler's RBAC gate reads.
func TestRoutes(t *testing.T) {
	want := map[string]struct {
		queue   string
		body    bool
		success int
	}{
		"GET /api/v1/workspaces/{workspace_id}/discord/roles":          {"rpc.discord.workspace_roles", false, 0},
		"GET /api/v1/workspaces/{workspace_id}/discord/channels":       {"rpc.discord.workspace_channels", false, 0},
		"GET /api/v1/workspaces/{workspace_id}/discord/guild":          {"rpc.discord.workspace_guild", false, 0},
		"GET /api/v1/admin/tournaments/{id}/discord-channel":           {"rpc.discord.channel.get", false, 0},
		"POST /api/v1/admin/tournaments/{id}/discord-channel":          {"rpc.discord.channel.upsert", true, 0},
		"POST /api/v1/admin/tournaments/{id}/discord-channel/backfill": {"rpc.discord.channel.backfill", false, 0},
		"DELETE /api/v1/admin/tournaments/{id}/discord-channel":        {"rpc.discord.channel.delete", false, 204},
	}
	for _, route := range Routes {
		key := route.Method + " " + route.Pattern
		w, ok := want[key]
		if !ok {
			t.Fatalf("unexpected route %s: %#v", key, route)
		}
		if route.Queue != w.queue || route.Body != w.body || route.Success != w.success || route.Auth != edge.AuthRequired {
			t.Fatalf("unexpected %s: %#v", key, route)
		}
		scoped := slices.Equal(route.Path, []string{"workspace_id"}) && route.IDParam == ""
		if route.IDParam == "id" {
			scoped = len(route.Path) == 0
		}
		if !scoped {
			t.Fatalf("%s must forward exactly one scope param: %#v", key, route)
		}
		delete(want, key)
	}
	if len(want) != 0 {
		t.Fatalf("missing discord routes: %#v", want)
	}
}

// TestRoutesRegisterWithoutConflict guards against ServeMux pattern conflicts,
// which panic at registration time (runtime), not at build time. The backfill
// leaf nests under the binding's pattern, so the two must coexist.
func TestRoutesRegisterWithoutConflict(t *testing.T) {
	mux := http.NewServeMux()
	dummy := func(http.ResponseWriter, *http.Request) {}
	for _, s := range Routes {
		mux.HandleFunc(s.Method+" "+s.Pattern, dummy)
	}
}
