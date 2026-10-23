package tournament

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// DashboardRoutes are the organizer's dashboard reads (src/rpc/dashboard.py).
// Auth is required at the edge; the worker enforces the workspace RBAC gate
// (readiness: ANY(tournament.read, team.read); dashboard: ANY of the five
// workspace read permissions, groups masked per grant; trends: tournament.read).
// The readiness pattern shares /api/v1/admin/tournaments/{id}/... with the
// other tournament and stats admin routes (distinct leaves — no ServeMux conflict).
var DashboardRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/v1/admin/tournaments/{id}/readiness", Queue: "rpc.tournament.tournament_readiness", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/dashboard", Queue: "rpc.tournament.admin_dashboard", Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/dashboard/trends", Queue: "rpc.tournament.admin_dashboard_trends", Query: []string{"workspace_id", "discipline"}, Auth: edge.AuthRequired},
}
