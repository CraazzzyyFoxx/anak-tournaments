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
// (DivisionGridRoutes, StageSubtreeRoutes, RegistrationTeamSubtreeRoutes) are
// deliberately ambiguous and mounted via edge.Subtree — plus the subtree prefixes
// and multipart handlers wired in cmd/gateway/main.go.
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
	// Subtree prefixes registered in main.go: less specific than every precise
	// pattern above, so they must coexist with them.
	mux.Handle("/api/v1/registration-teams/", http.NotFoundHandler())
	// Multipart handlers registered directly in main.go.
	mux.HandleFunc("POST /api/v1/admin/teams/{team_id}/image", dummy)
	mux.HandleFunc("POST /api/v1/registration-teams/{team_id}/image", dummy)
}

// TestRegistrationTeamCrestRouting pins the precedence the crest DELETE depends
// on. Its pattern cannot be registered on the ServeMux at all (it is ambiguous
// with the invite-revoke wildcard), so it is served by the subtree mounted at
// /api/v1/registration-teams/ — which must NOT shadow the precise sibling
// patterns registered alongside it.
func TestRegistrationTeamCrestRouting(t *testing.T) {
	mux := http.NewServeMux()
	hit := ""
	mark := func(name string) http.HandlerFunc {
		return func(http.ResponseWriter, *http.Request) { hit = name }
	}
	for _, s := range PublicWriteRoutes {
		mux.HandleFunc(s.Method+" "+s.Pattern, mark(s.Queue))
	}
	mux.Handle("/api/v1/registration-teams/", mark("subtree"))
	mux.HandleFunc("POST /api/v1/registration-teams/{team_id}/image", mark("rpc.tournament.regteam_image_upload"))

	for _, tc := range []struct{ method, path, want string }{
		{"DELETE", "/api/v1/registration-teams/5/image", "subtree"},
		{"POST", "/api/v1/registration-teams/5/image", "rpc.tournament.regteam_image_upload"},
		// The siblings the subtree must not swallow.
		{"DELETE", "/api/v1/registration-teams/invites/9", "rpc.tournament.regteam_invite_revoke"},
		{"DELETE", "/api/v1/registration-teams/5", "rpc.tournament.regteam_disband"},
		{"DELETE", "/api/v1/registration-teams/5/members/me", "rpc.tournament.regteam_leave"},
		{"POST", "/api/v1/registration-teams/invites/accept", "rpc.tournament.regteam_accept"},
	} {
		hit = ""
		req, err := http.NewRequest(tc.method, tc.path, nil)
		if err != nil {
			t.Fatal(err)
		}
		mux.ServeHTTP(nil, req)
		if hit != tc.want {
			t.Errorf("%s %s routed to %q, want %q", tc.method, tc.path, hit, tc.want)
		}
	}
}
