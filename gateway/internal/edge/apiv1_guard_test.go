package edge_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/app"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/balancer"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/identity"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/parser"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/stream"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/tournament"
)

// errCaller stands in for the RPC client; routing assertions never need a real
// reply (the cases we check resolve before any RPC call).
type errCaller struct{}

func (errCaller) Call(_ context.Context, _ string, _ []byte) ([]byte, error) {
	return nil, context.Canceled
}

func marker(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Route", name)
		w.WriteHeader(http.StatusOK)
	}
}

// buildGuardedMux mirrors gateway/cmd/gateway/main.go's /api/v1 wiring. Building
// it must NOT panic — a ServeMux pattern conflict would crash the gateway at
// startup. app + tournament + parser now share the unified /api/v1/* namespace
// (the old /api/v1/core and /api/parser prefixes are gone), so this guards the
// merged surface. Any unmatched /api/v1/* must hit the /api/v1/ guard (404),
// never the "/" frontend catch-all (which rewrites /api/v1/* back to the gateway
// -> infinite proxy loop).
func buildGuardedMux(t *testing.T) *http.ServeMux {
	t.Helper()
	d := edge.New(errCaller{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	mux := http.NewServeMux()
	d.Register(mux, tournament.PublicReadRoutes)
	d.Register(mux, tournament.AdminCrudRoutes)
	d.Register(mux, tournament.AdminMiscRoutes)
	d.Register(mux, tournament.RegistrationAdminRoutes)
	d.Register(mux, tournament.IntegrationsRoutes)
	d.Register(mux, tournament.PublicWriteRoutes)
	d.Register(mux, tournament.ScrimRoutes)
	mux.Handle("/api/v1/division-grids/", d.Subtree(tournament.DivisionGridRoutes))
	mux.Handle("/api/v1/admin/stages/", d.Subtree(tournament.StageSubtreeRoutes))
	// app-service typed routes (reads + workspace/metadata/users admin) + the
	// achievements get subtree. Registering these must NOT panic — /users/{name}
	// vs /users/{id}/... and the achievements /{id}/users vs /user/{user_id}
	// ambiguity are the cases that would conflict.
	d.Register(mux, app.ReadRoutes)
	d.Register(mux, app.WorkspaceWriteRoutes)
	d.Register(mux, app.MetadataAdminRoutes)
	d.Register(mux, app.UsersAdminRoutes)
	d.Register(mux, app.TournamentAdminRoutes)
	mux.Handle("/api/v1/achievements/", d.Subtree(app.AchievementsSubtreeRoutes))
	// parser domains folded into /api/v1. The achievement-rule admin subtree mounts
	// at the shared /api/v1/admin/ws/ prefix; tournament's balancer-statuses routes
	// there are more specific and win, so registering both must not panic. The
	// discord-channel routes share /api/v1/admin/tournaments/{id}/... with the
	// tournament admin routes (distinct leaves).
	d.Register(mux, parser.Routes)
	mux.Handle("/api/v1/admin/ws/", d.Subtree(parser.AchievementAdminRoutes))
	// Binary/multipart handlers (registering them must not conflict with the
	// workspace member routes or the get-by-id routes).
	bin := app.NewBinary(errCaller{}, func(*http.Request) (map[string]any, bool, error) { return nil, false, nil },
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	mux.HandleFunc("POST /api/v1/workspaces/{id}/icon", bin.IconUpload)
	mux.HandleFunc("DELETE /api/v1/workspaces/{id}/icon", bin.IconDelete)
	mux.HandleFunc("POST /api/v1/assets/{asset_type}/{slug}", bin.AssetUpload)
	mux.HandleFunc("DELETE /api/v1/assets/{asset_type}/{slug}", bin.AssetDelete)
	mux.HandleFunc("GET /api/v1/matches/{match_id}/log", bin.MatchLog)
	mux.HandleFunc("POST /api/v1/admin/users/{id}/avatar", bin.UserAvatarUpload)
	mux.HandleFunc("POST /api/v1/user/create/csv", bin.UsersCsvImport)
	pbin := parser.NewBinary(errCaller{}, func(*http.Request) (map[string]any, bool, error) { return nil, false, nil },
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	mux.HandleFunc("POST /api/v1/admin/logs/upload", pbin.AdminLogsUpload)
	mux.HandleFunc("POST /api/v1/teams/create/balancer", pbin.TeamsBalancerUpload)
	// Unmatched /api/v1/* falls to the /api/v1/ guard (404), never the "/" frontend
	// catch-all.
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Route", "guard")
		w.WriteHeader(http.StatusNotFound)
	})
	mux.Handle("/", marker("frontend"))
	return mux
}

func TestApiV1Guard_NoConflictAndNoLoop(t *testing.T) {
	mux := buildGuardedMux(t) // panics here on any ServeMux pattern conflict
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cases := []struct {
		name      string
		method    string
		path      string
		wantRoute string // "" => expect the /api/v1/ guard 404
	}{
		{"unknown top-level api path", "GET", "/api/v1/does-not-exist", ""},
		{"deep unmatched tournament path", "GET", "/api/v1/tournaments/123/nope", ""},
		{"unknown deep api path hits guard", "GET", "/api/v1/nonexistent-xyz", ""},
		{"non-api path hits frontend", "GET", "/users/someone", "frontend"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest(c.method, srv.URL+c.path, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", c.method, c.path, err)
			}
			defer resp.Body.Close()
			route := resp.Header.Get("X-Route")
			if c.wantRoute == "" {
				if resp.StatusCode != http.StatusNotFound || route != "guard" {
					t.Fatalf("%s %s: got route=%q status=%d, want the /api/v1/ guard (404). "+
						"Falling through to the frontend would re-create the proxy loop.",
						c.method, c.path, route, resp.StatusCode)
				}
				return
			}
			if route != c.wantRoute {
				t.Fatalf("%s %s: routed to %q, want %q", c.method, c.path, route, c.wantRoute)
			}
		})
	}
}

// A new /api/v1/admin/... path is only reachable if it is in a table main.go
// registers — otherwise the /api/v1/ guard answers 404 and the feature is dead
// on arrival with no compile error to warn anyone. These ride the existing
// AdminMiscRoutes table, and this pins that they actually made it onto the mux.
func TestApiV1Guard_MatchSurfaceRoutesAreRegistered(t *testing.T) {
	mux := buildGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	for _, path := range []string{
		"/api/v1/admin/encounter-reports?workspace_id=1",
		"/api/v1/admin/encounter-reports/stats?workspace_id=1",
		"/api/v1/admin/matches?workspace_id=1",
		// The collection must not swallow this as an id, nor the id pattern
		// shadow the collection.
		"/api/v1/admin/matches/42?workspace_id=1",
		// The per-tournament report-form config sits under the {tournament_id}
		// prefix shared with finish/status/schedule/preview-access.
		"/api/v1/admin/tournaments/7/report-form",
	} {
		t.Run(path, func(t *testing.T) {
			resp, err := http.Get(srv.URL + path)
			if err != nil {
				t.Fatalf("GET %s: %v", path, err)
			}
			defer resp.Body.Close()
			if route := resp.Header.Get("X-Route"); route == "guard" {
				t.Fatalf("GET %s hit the /api/v1/ guard — the route is not registered", path)
			}
		})
	}
}

// Scrim rooms ride their own table (tournament.ScrimRoutes,
// docs/plans/2026-08-12-scrim-rooms.md), so a missing main.go registration
// would leave every path answered by the /api/v1/ guard with no compile error.
// The bare collection and the {token} routes must also not shadow each other:
// the share token is an opaque string, so /api/v1/scrims must keep matching the
// collection rather than being read as a token.
func TestApiV1Guard_ScrimRoutesAreRegistered(t *testing.T) {
	mux := buildGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/scrims"},
		{http.MethodGet, "/api/v1/scrims?workspace_id=1"},
		{http.MethodGet, "/api/v1/scrims/aBc123"},
		{http.MethodPost, "/api/v1/scrims/aBc123/claim"},
		{http.MethodPost, "/api/v1/scrims/aBc123/close"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req, err := http.NewRequest(tc.method, srv.URL+tc.path, http.NoBody)
			if err != nil {
				t.Fatalf("build %s %s: %v", tc.method, tc.path, err)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", tc.method, tc.path, err)
			}
			defer resp.Body.Close()
			if route := resp.Header.Get("X-Route"); route == "guard" {
				t.Fatalf("%s %s hit the /api/v1/ guard — the route is not registered", tc.method, tc.path)
			}
		})
	}
}

// The self-service /api/v1/me/* surface rides app.UsersAdminRoutes. Two things
// can break it silently: a missing registration (the /api/v1/ guard answers 404
// with no compile error), and a new leaf being read as a {account_id} of the
// social routes. /me/stream-visibility is a sibling leaf of /me/social/..., so
// this pins that it keeps its own pattern instead of being swallowed.
func TestApiV1Guard_MeRoutesAreRegistered(t *testing.T) {
	mux := buildGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/v1/me/social"},
		{http.MethodPost, "/api/v1/me/social/5/primary"},
		{http.MethodPost, "/api/v1/me/social/5/visibility"},
		{http.MethodPost, "/api/v1/me/stream-visibility"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req, err := http.NewRequest(tc.method, srv.URL+tc.path, http.NoBody)
			if err != nil {
				t.Fatalf("build %s %s: %v", tc.method, tc.path, err)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", tc.method, tc.path, err)
			}
			defer resp.Body.Close()
			switch route := resp.Header.Get("X-Route"); route {
			case "frontend", "guard":
				t.Fatalf("%s %s: routed to %q, want the typed dispatcher — the route is not registered",
					tc.method, tc.path, route)
			}
		})
	}
}

// buildBalancerGuardedMux mirrors gateway/cmd/gateway/main.go's /api/balancer
// wiring. Building it must NOT panic (a ServeMux pattern conflict would crash the
// gateway at startup). The HTTP balancer-service is decommissioned: every
// /api/balancer/* path is a typed RPC route here, and unmatched paths must hit the
// /api/balancer/ guard (404), never the "/" frontend catch-all (which rewrites
// /api/balancer/* back to the gateway -> infinite proxy loop).
func buildBalancerGuardedMux(t *testing.T) *http.ServeMux {
	t.Helper()
	d := edge.New(errCaller{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	mux := http.NewServeMux()
	d.Register(mux, balancer.PublicRoutes)
	d.Register(mux, balancer.AdminRoutes)
	d.Register(mux, balancer.DraftReadRoutes)
	d.Register(mux, balancer.DraftRoutes)
	d.Register(mux, balancer.JobRoutes)
	bbin := balancer.NewBinary(errCaller{}, func(*http.Request) (map[string]any, bool, error) { return nil, false, nil },
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	mux.HandleFunc("POST /api/balancer/tournaments/{tournament_id}/teams/import", bbin.TeamsImport)
	mux.HandleFunc("POST /api/balancer/jobs", bbin.JobCreate)
	mux.HandleFunc("/api/balancer/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Route", "guard")
		w.WriteHeader(http.StatusNotFound)
	})
	mux.Handle("/", marker("frontend"))
	return mux
}

func TestApiBalancerGuard_NoConflictAndNoLoop(t *testing.T) {
	mux := buildBalancerGuardedMux(t) // panics here on any ServeMux pattern conflict
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cases := []struct {
		name      string
		method    string
		path      string
		wantRoute string // "" => expect the /api/balancer/ guard 404
	}{
		{"unmatched balancer path", "GET", "/api/balancer/does-not-exist", ""},
		{"unmatched draft path", "GET", "/api/balancer/draft/nope", ""},
		{"dead sse stream is gone", "GET", "/api/balancer/jobs/abc/stream", ""},
		{"non-api path hits frontend", "GET", "/users/someone", "frontend"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest(c.method, srv.URL+c.path, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", c.method, c.path, err)
			}
			defer resp.Body.Close()
			route := resp.Header.Get("X-Route")
			if c.wantRoute == "" {
				if resp.StatusCode != http.StatusNotFound || route != "guard" {
					t.Fatalf("%s %s: got route=%q status=%d, want the /api/balancer/ guard (404). "+
						"Falling through to the frontend would re-create the proxy loop.",
						c.method, c.path, route, resp.StatusCode)
				}
				return
			}
			if route != c.wantRoute {
				t.Fatalf("%s %s: routed to %q, want %q", c.method, c.path, route, c.wantRoute)
			}
		})
	}
}

// TestApiBalancer_MigratedRoutesHitDispatcher asserts the typed balancer routes win
// over the /api/balancer/ guard (ServeMux specificity) and reach the dispatcher
// (empty X-Route with the stub RPC caller), never "frontend"/"guard".
func TestApiBalancer_MigratedRoutesHitDispatcher(t *testing.T) {
	mux := buildBalancerGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	paths := []string{
		"/api/balancer/config",
		"/api/balancer/draft/sessions/abc",
		"/api/balancer/draft/tournaments/5/draft",
		"/api/balancer/draft/sessions/abc/board",
	}
	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			resp, err := http.Get(srv.URL + p)
			if err != nil {
				t.Fatalf("GET %s: %v", p, err)
			}
			defer resp.Body.Close()
			switch resp.Header.Get("X-Route") {
			case "frontend", "guard":
				t.Fatalf("GET %s: routed to %q, want the typed dispatcher (not proxied)",
					p, resp.Header.Get("X-Route"))
			}
		})
	}
}

// TestApiV1_MigratedReadsHitDispatcher asserts the migrated app + parser read
// patterns win over the /api/v1/ guard (ServeMux specificity) and reach the typed
// dispatcher. With the stub RPC caller the dispatcher returns 504 (or 401 for
// auth'd routes), so a migrated path yields an empty X-Route (typed handler) —
// never "frontend"/"guard".
func TestApiV1_MigratedReadsHitDispatcher(t *testing.T) {
	mux := buildGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	paths := []string{
		// app-service (was /api/v1/core)
		"/api/v1/heroes",
		"/api/v1/heroes/5",
		"/api/v1/heroes/lookup",
		"/api/v1/heroes/5/leaderboard",
		"/api/v1/heroes/statistics/playtime",
		"/api/v1/maps",
		"/api/v1/maps/5",
		"/api/v1/maps/lookup",
		"/api/v1/gamemodes/5",
		"/api/v1/achievements",
		"/api/v1/achievements/5",
		"/api/v1/achievements/5/users",
		"/api/v1/achievements/user/7",
		"/api/v1/users",
		"/api/v1/users/search",
		"/api/v1/users/overview",
		"/api/v1/users/overview/stats",
		"/api/v1/users/5/profile",
		"/api/v1/users/5/tournaments/9",
		"/api/v1/users/5/maps/summary",
		"/api/v1/users/someblizzname",
		"/api/v1/statistics/dashboard",
		"/api/v1/statistics/won-maps",
		"/api/v1/workspaces",
		"/api/v1/workspaces/5",
		"/api/v1/matches/9/log",
		// parser-service (was /api/parser), folded into /api/v1
		"/api/v1/users/5/rank-history",
		"/api/v1/users/5/current-ranks",
		"/api/v1/battle-tags/5/rank-history",
	}
	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			resp, err := http.Get(srv.URL + p)
			if err != nil {
				t.Fatalf("GET %s: %v", p, err)
			}
			defer resp.Body.Close()
			switch resp.Header.Get("X-Route") {
			case "frontend", "guard":
				t.Fatalf("GET %s: routed to %q, want the typed dispatcher (not proxied)",
					p, resp.Header.Get("X-Route"))
			}
		})
	}
}

// buildAuthGuardedMux mirrors gateway/cmd/gateway/main.go's /api/auth wiring. The
// HTTP-over-RPC tunnel + auth-service proxy are decommissioned: every /api/auth/*
// path is now a typed RPC route here, and unmatched paths must hit the /api/auth/
// guard (404), never the "/" frontend catch-all (which rewrites /api/auth/* back
// to the gateway -> infinite proxy loop). Building it must NOT panic — the rbac
// users/{user_id} vs users/assign-role and the player linked/{player_id}/primary
// patterns are the cases that would conflict under ServeMux.
func buildAuthGuardedMux(t *testing.T) *http.ServeMux {
	t.Helper()
	h := identity.NewHandler(errCaller{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/validate", h.Validate)
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("GET /api/auth/sessions", h.Sessions)
	mux.HandleFunc("DELETE /api/auth/sessions/{id}", h.RevokeSession)
	mux.HandleFunc("GET /api/auth/me", h.Me)
	mux.HandleFunc("PATCH /api/auth/me", h.UpdateMe)
	mux.HandleFunc("GET /api/auth/oauth/connections", h.OAuthConnections)
	mux.HandleFunc("GET /api/auth/oauth/{provider}/url", h.OAuthURL)
	mux.HandleFunc("GET /api/auth/api-keys", h.ListApiKeys)
	mux.HandleFunc("PATCH /api/auth/api-keys/{id}", h.UpdateApiKey)
	// RBAC admin.
	mux.HandleFunc("GET /api/auth/rbac/permissions", h.RbacListPermissions)
	mux.HandleFunc("POST /api/auth/rbac/permissions", h.RbacCreatePermission)
	mux.HandleFunc("DELETE /api/auth/rbac/permissions/{permission_id}", h.RbacDeletePermission)
	mux.HandleFunc("GET /api/auth/rbac/roles", h.RbacListRoles)
	mux.HandleFunc("POST /api/auth/rbac/roles", h.RbacCreateRole)
	mux.HandleFunc("GET /api/auth/rbac/roles/{role_id}", h.RbacGetRole)
	mux.HandleFunc("PATCH /api/auth/rbac/roles/{role_id}", h.RbacUpdateRole)
	mux.HandleFunc("DELETE /api/auth/rbac/roles/{role_id}", h.RbacDeleteRole)
	mux.HandleFunc("GET /api/auth/rbac/users", h.RbacListAuthUsers)
	mux.HandleFunc("POST /api/auth/rbac/users/assign-role", h.RbacAssignRole)
	mux.HandleFunc("POST /api/auth/rbac/users/remove-role", h.RbacRemoveRole)
	mux.HandleFunc("GET /api/auth/rbac/users/{user_id}", h.RbacGetAuthUser)
	mux.HandleFunc("DELETE /api/auth/rbac/users/{user_id}", h.RbacDeleteAuthUser)
	mux.HandleFunc("GET /api/auth/rbac/users/{user_id}/roles", h.RbacGetUserRoles)
	mux.HandleFunc("POST /api/auth/rbac/users/{user_id}/linked-players", h.RbacAssignLinkedPlayer)
	mux.HandleFunc("DELETE /api/auth/rbac/users/{user_id}/linked-players/{player_id}", h.RbacRemoveLinkedPlayer)
	mux.HandleFunc("GET /api/auth/rbac/oauth-connections", h.RbacListOAuthConnections)
	mux.HandleFunc("DELETE /api/auth/rbac/oauth-connections/{connection_id}", h.RbacDeleteOAuthConnection)
	mux.HandleFunc("GET /api/auth/rbac/sessions", h.RbacListSessions)
	// Player linking.
	mux.HandleFunc("POST /api/auth/player/link", h.PlayerLink)
	mux.HandleFunc("DELETE /api/auth/player/unlink/{player_id}", h.PlayerUnlink)
	mux.HandleFunc("GET /api/auth/player/linked", h.PlayerLinked)
	mux.HandleFunc("PATCH /api/auth/player/linked/{player_id}/primary", h.PlayerSetPrimary)
	// Avatar (multipart).
	bin := identity.NewBinary(h, nil)
	mux.HandleFunc("POST /api/auth/me/avatar", bin.AvatarSet)
	mux.HandleFunc("DELETE /api/auth/me/avatar", bin.AvatarDelete)
	mux.HandleFunc("/api/auth/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Route", "guard")
		w.WriteHeader(http.StatusNotFound)
	})
	mux.Handle("/", marker("frontend"))
	return mux
}

func TestApiAuthGuard_NoConflictAndNoLoop(t *testing.T) {
	mux := buildAuthGuardedMux(t) // panics here on any ServeMux pattern conflict
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cases := []struct {
		name      string
		method    string
		path      string
		wantRoute string // "" => expect the /api/auth/ guard 404
	}{
		{"unmatched auth path", "GET", "/api/auth/does-not-exist", ""},
		{"removed tunnel rbac typo path", "GET", "/api/auth/rbac/nope", ""},
		{"unmatched player path", "GET", "/api/auth/player/nope", ""},
		{"non-api path hits frontend", "GET", "/users/someone", "frontend"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest(c.method, srv.URL+c.path, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", c.method, c.path, err)
			}
			defer resp.Body.Close()
			route := resp.Header.Get("X-Route")
			if c.wantRoute == "" {
				if resp.StatusCode != http.StatusNotFound || route != "guard" {
					t.Fatalf("%s %s: got route=%q status=%d, want the /api/auth/ guard (404). "+
						"Falling through to the frontend would re-create the proxy loop.",
						c.method, c.path, route, resp.StatusCode)
				}
				return
			}
			if route != c.wantRoute {
				t.Fatalf("%s %s: routed to %q, want %q", c.method, c.path, route, c.wantRoute)
			}
		})
	}
}

// TestApiAuth_TypedRoutesHitHandler asserts the typed RBAC/player/avatar routes win
// over the /api/auth/ guard (ServeMux specificity) and reach the identity handler
// (401 without a bearer, or 504 with the stub caller), never "frontend"/"guard".
func TestApiAuth_TypedRoutesHitHandler(t *testing.T) {
	mux := buildAuthGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cases := []struct {
		method string
		path   string
	}{
		{"GET", "/api/auth/rbac/permissions"},
		{"GET", "/api/auth/rbac/roles"},
		{"GET", "/api/auth/rbac/roles/5"},
		{"GET", "/api/auth/rbac/users"},
		{"POST", "/api/auth/rbac/users/assign-role"},
		{"POST", "/api/auth/rbac/users/remove-role"},
		{"GET", "/api/auth/rbac/users/5"},
		{"DELETE", "/api/auth/rbac/users/5"},
		{"GET", "/api/auth/rbac/users/5/roles"},
		{"POST", "/api/auth/rbac/users/5/linked-players"},
		{"DELETE", "/api/auth/rbac/users/5/linked-players/9"},
		{"GET", "/api/auth/rbac/oauth-connections"},
		{"DELETE", "/api/auth/rbac/oauth-connections/3"},
		{"GET", "/api/auth/rbac/sessions"},
		{"POST", "/api/auth/player/link"},
		{"DELETE", "/api/auth/player/unlink/5"},
		{"GET", "/api/auth/player/linked"},
		{"PATCH", "/api/auth/player/linked/5/primary"},
		{"POST", "/api/auth/me/avatar"},
		{"DELETE", "/api/auth/me/avatar"},
	}
	for _, c := range cases {
		t.Run(c.method+" "+c.path, func(t *testing.T) {
			req, _ := http.NewRequest(c.method, srv.URL+c.path, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", c.method, c.path, err)
			}
			defer resp.Body.Close()
			switch resp.Header.Get("X-Route") {
			case "frontend", "guard":
				t.Fatalf("%s %s: routed to %q, want the typed identity handler (not proxied)",
					c.method, c.path, resp.Header.Get("X-Route"))
			}
		})
	}
}

// buildStreamsGuardedMux mirrors gateway/cmd/gateway/main.go's /api/streams
// wiring. Building it must NOT panic (a ServeMux pattern conflict would crash
// the gateway at startup): the repoll route nests under the read route's
// {tournament_id}, so the two must coexist. There is no HTTP stream-service —
// every /api/streams/* path is a typed RPC route here, and unmatched paths must
// hit the /api/streams/ guard (404), never the "/" frontend catch-all (which
// rewrites /api/streams/* back to the gateway -> infinite proxy loop).
func buildStreamsGuardedMux(t *testing.T) *http.ServeMux {
	t.Helper()
	d := edge.New(errCaller{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	mux := http.NewServeMux()
	d.Register(mux, stream.PublicRoutes)
	d.Register(mux, stream.AdminRoutes)
	mux.HandleFunc("/api/streams/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Route", "guard")
		w.WriteHeader(http.StatusNotFound)
	})
	mux.Handle("/", marker("frontend"))
	return mux
}

func TestApiStreamsGuard_NoConflictAndNoLoop(t *testing.T) {
	mux := buildStreamsGuardedMux(t) // panics here on any ServeMux pattern conflict
	srv := httptest.NewServer(mux)
	defer srv.Close()

	cases := []struct {
		name      string
		method    string
		path      string
		wantRoute string // "" => expect the /api/streams/ guard 404
	}{
		{"unmatched streams path", "GET", "/api/streams/does-not-exist", ""},
		{"unmatched tournament leaf", "GET", "/api/streams/tournament/7/nope", ""},
		{"read is GET-only", "DELETE", "/api/streams/tournament/7", ""},
		{"non-api path hits frontend", "GET", "/users/someone", "frontend"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest(c.method, srv.URL+c.path, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", c.method, c.path, err)
			}
			defer resp.Body.Close()
			route := resp.Header.Get("X-Route")
			if c.wantRoute == "" {
				if resp.StatusCode != http.StatusNotFound || route != "guard" {
					t.Fatalf("%s %s: got route=%q status=%d, want the /api/streams/ guard (404). "+
						"Falling through to the frontend would re-create the proxy loop.",
						c.method, c.path, route, resp.StatusCode)
				}
				return
			}
			if route != c.wantRoute {
				t.Fatalf("%s %s: routed to %q, want %q", c.method, c.path, route, c.wantRoute)
			}
		})
	}
}

// The streams surface rides its own tables (stream.PublicRoutes /
// stream.AdminRoutes), so a missing main.go registration would leave every path
// answered by the /api/streams/ guard with 404 — the feature dead on arrival
// with no compile error to warn anyone. This pins that both made it onto the mux.
func TestApiStreamsGuard_RoutesAreRegistered(t *testing.T) {
	mux := buildStreamsGuardedMux(t)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/streams/tournament/7"},
		{http.MethodPost, "/api/streams/tournament/7/repoll?workspace_id=1"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req, err := http.NewRequest(tc.method, srv.URL+tc.path, http.NoBody)
			if err != nil {
				t.Fatalf("build %s %s: %v", tc.method, tc.path, err)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("%s %s: %v", tc.method, tc.path, err)
			}
			defer resp.Body.Close()
			switch route := resp.Header.Get("X-Route"); route {
			case "frontend", "guard":
				t.Fatalf("%s %s: routed to %q, want the typed dispatcher — the route is not registered",
					tc.method, tc.path, route)
			}
		})
	}
}
