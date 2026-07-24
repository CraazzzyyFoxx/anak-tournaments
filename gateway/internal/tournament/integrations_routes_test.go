package tournament

import (
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

func TestDivisionGridManagementRouteContracts(t *testing.T) {
	want := map[string]struct {
		method  string
		queue   string
		body    bool
		idParam string
		success int
	}{
		"/api/v1/division-grids/by-workspace/{workspace_id}/marketplace/preflight": {
			method: "POST", queue: "rpc.tournament.grid_marketplace_preflight", body: true,
		},
		"/api/v1/division-grids/by-workspace/{workspace_id}/marketplace/import": {
			method: "POST", queue: "rpc.tournament.grid_marketplace_import", body: true, success: 202,
		},
		"/api/v1/division-grids/by-workspace/{workspace_id}/import-jobs": {
			method: "GET", queue: "rpc.tournament.grid_import_jobs_list",
		},
		"/api/v1/division-grids/by-workspace/{workspace_id}/import-jobs/{job_id}": {
			method: "GET", queue: "rpc.tournament.grid_import_job_get",
		},
		"/api/v1/division-grids/library/{grid_id}": {
			method: "PATCH", queue: "rpc.tournament.grid_update", body: true, idParam: "grid_id",
		},
		"/api/v1/division-grids/library/{grid_id}/export": {
			method: "GET", queue: "rpc.tournament.grid_portable_export", idParam: "grid_id",
		},
		"/api/v1/division-grids/by-workspace/{workspace_id}/portable/import": {
			method: "POST", queue: "rpc.tournament.grid_portable_import", body: true, success: 201,
		},
		"/api/v1/division-grids/by-workspace/{workspace_id}/versions/{version_id}/readiness": {
			method: "GET", queue: "rpc.tournament.grid_version_readiness",
		},
		"/api/v1/division-grids/by-workspace/{workspace_id}/versions/{version_id}/activate": {
			method: "POST", queue: "rpc.tournament.grid_version_activate",
		},
	}

	for _, route := range DivisionGridRoutes {
		expected, ok := want[route.Pattern]
		if !ok || route.Method != expected.method {
			continue
		}
		if route.Queue != expected.queue || route.Body != expected.body || route.Auth != edge.AuthRequired ||
			route.IDParam != expected.idParam || route.Success != expected.success {
			t.Errorf("unexpected division-grid route contract for %s %s: %#v", route.Method, route.Pattern, route)
		}
		delete(want, route.Pattern)
	}
	if len(want) != 0 {
		t.Fatalf("missing division-grid management routes: %#v", want)
	}
}
