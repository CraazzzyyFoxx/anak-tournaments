package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// TournamentAdminRoutes are tournament-scoped admin reads owned by app-service.
// Auth is required at the edge; the worker enforces the workspace RBAC gate
// (readiness: ANY(tournament.read, team.read), fields masked per granted group).
// The pattern shares /api/v1/admin/tournaments/{id}/... with the tournament and
// parser admin routes (distinct leaves — no ServeMux conflict).
var TournamentAdminRoutes = []edge.RouteSpec{
	{Method: "GET", Pattern: "/api/v1/admin/tournaments/{id}/readiness", Queue: "rpc.app.statistics.tournament_readiness", IDParam: "id", Auth: edge.AuthRequired},
}
