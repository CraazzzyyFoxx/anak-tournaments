package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// TournamentAdminRoutes are the organizer's tournament reads owned by app-service.
// Auth is required at the edge; the worker enforces the workspace RBAC gate
// (readiness: ANY(tournament.read, team.read); dashboard: ANY of the five
// workspace read permissions, groups masked per grant; trends: tournament.read).
// The readiness pattern shares /api/v1/admin/tournaments/{id}/... with the
// tournament and parser admin routes (distinct leaves — no ServeMux conflict).
var TournamentAdminRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/v1/admin/tournaments/{id}/readiness", Queue: "rpc.app.statistics.tournament_readiness", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/dashboard", Queue: "rpc.app.statistics.admin_dashboard", Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/dashboard/trends", Queue: "rpc.app.statistics.admin_dashboard_trends", Query: []string{"workspace_id", "discipline"}, Auth: edge.AuthRequired},
}
