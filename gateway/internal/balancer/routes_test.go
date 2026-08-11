package balancer

import (
	"net/http"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

func TestDraftSafetyRoutes(t *testing.T) {
	want := map[string]struct {
		method string
		queue  string
	}{
		"/api/balancer/draft/sessions/{session_id}/feasibility": {
			method: "GET",
			queue:  "rpc.balancer.draft.feasibility",
		},
		"/api/balancer/draft/picks/{pick_id}/options": {
			method: "GET",
			queue:  "rpc.balancer.draft.pick_options",
		},
		"/api/balancer/draft/sessions/{session_id}/players/{player_id}/roles": {
			method: "POST",
			queue:  "rpc.balancer.draft.player_role_edit",
		},
	}

	for _, route := range DraftRoutes {
		expected, ok := want[route.Pattern]
		if !ok {
			continue
		}
		if route.Method != expected.method || route.Queue != expected.queue || route.Auth != edge.AuthRequired {
			t.Fatalf("unexpected route contract for %s: %#v", route.Pattern, route)
		}
		delete(want, route.Pattern)
	}
	if len(want) != 0 {
		t.Fatalf("missing draft safety routes: %#v", want)
	}
}

// TestDraftSessionHistoryRoutes pins the admin draft-history surface: listing a
// tournament's sessions and erasing one. The DELETE shares its pattern with the
// PATCH (session_patch), so a wrong Method here silently reroutes an erase.
func TestDraftSessionHistoryRoutes(t *testing.T) {
	var list, del *edge.RouteSpec
	for i, route := range DraftRoutes {
		switch route.Queue {
		case "rpc.balancer.draft.session_list":
			list = &DraftRoutes[i]
		case "rpc.balancer.draft.session_delete":
			del = &DraftRoutes[i]
		}
	}
	if list == nil || del == nil {
		t.Fatal("draft session list/delete routes are not registered")
	}
	if list.Method != "GET" || list.Pattern != "/api/balancer/draft/tournaments/{tournament_id}/sessions" || list.IDParam != "tournament_id" || list.Auth != edge.AuthRequired {
		t.Fatalf("unexpected session_list contract: %#v", *list)
	}
	if del.Method != "DELETE" || del.Pattern != "/api/balancer/draft/tournaments/{tournament_id}/sessions/{session_id}" || del.IDParam != "session_id" || del.Success != 204 || del.Auth != edge.AuthRequired {
		t.Fatalf("unexpected session_delete contract: %#v", *del)
	}
	if len(del.Path) != 1 || del.Path[0] != "tournament_id" {
		t.Fatalf("session_delete must forward tournament_id for the permission check: %#v", del.Path)
	}
}

// TestRoutesRegisterWithoutConflict guards against ServeMux pattern conflicts,
// which panic at registration time (runtime), not at build time. It registers
// the entire balancer route surface — the typed route tables plus the two
// multipart handlers wired in cmd/gateway/main.go — onto a fresh mux.
func TestRoutesRegisterWithoutConflict(t *testing.T) {
	mux := http.NewServeMux()
	dummy := func(http.ResponseWriter, *http.Request) {}

	for _, set := range [][]edge.RouteSpec{PublicRoutes, AdminRoutes, DraftReadRoutes, DraftRoutes, JobRoutes} {
		for _, s := range set {
			mux.HandleFunc(s.Method+" "+s.Pattern, dummy)
		}
	}
	// Multipart handlers registered directly in main.go.
	mux.HandleFunc("POST /api/balancer/tournaments/{tournament_id}/teams/import", dummy)
	mux.HandleFunc("POST /api/balancer/jobs", dummy)
}
