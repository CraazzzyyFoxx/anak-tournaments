package tournament

import (
	"net/http"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

// TestTeamImageRouteContracts pins the team-logo surface: the DELETE is a typed
// method on the dispatcher (no Entity/Action, so it never reaches the generic CRUD
// engine and can't be mistaken for the team delete), and the POST is documented
// for the multipart binary handler.
func TestTeamImageRouteContracts(t *testing.T) {
	const pattern = "/api/v1/admin/teams/{team_id}/image"

	var del *edge.RouteSpec
	for i, r := range AdminCrudRoutes {
		if r.Pattern == pattern {
			del = &AdminCrudRoutes[i]
		}
	}
	if del == nil {
		t.Fatalf("%s DELETE is not registered", pattern)
	}
	if del.Method != "DELETE" || del.Queue != "rpc.tournament.teams.image_delete" || del.IDParam != "team_id" || del.Auth != edge.AuthRequired {
		t.Fatalf("unexpected image_delete contract: %#v", *del)
	}
	if del.Entity != "" || del.Action != "" {
		t.Fatalf("image_delete is a typed method, not generic CRUD: %#v", *del)
	}

	var up *edge.RouteSpec
	for i, r := range BinaryDocRoutes {
		if r.Pattern == pattern {
			up = &BinaryDocRoutes[i]
		}
	}
	if up == nil {
		t.Fatalf("%s POST is not documented in BinaryDocRoutes", pattern)
	}
	if up.Method != "POST" || up.Queue != "rpc.tournament.teams.image_upload" || up.Auth != edge.AuthRequired {
		t.Fatalf("unexpected image_upload contract: %#v", *up)
	}
}

// TestRoutesRegisterWithoutConflict guards against ServeMux pattern conflicts,
// which panic at registration time (runtime), not at build time. It registers the
// tournament route tables that are mounted as patterns — the subtree tables
// (DivisionGridRoutes, StageSubtreeRoutes) are deliberately ambiguous and mounted
// via edge.Subtree — plus the multipart handler wired in cmd/gateway/main.go.
func TestRoutesRegisterWithoutConflict(t *testing.T) {
	mux := http.NewServeMux()
	dummy := func(http.ResponseWriter, *http.Request) {}

	for _, set := range [][]edge.RouteSpec{
		PublicReadRoutes, PublicWriteRoutes, AdminCrudRoutes, AdminMiscRoutes,
		RegistrationAdminRoutes, IntegrationsRoutes, ScrimRoutes,
	} {
		for _, s := range set {
			mux.HandleFunc(s.Method+" "+s.Pattern, dummy)
		}
	}
	// Multipart handler registered directly in main.go.
	mux.HandleFunc("POST /api/v1/admin/teams/{team_id}/image", dummy)
}
