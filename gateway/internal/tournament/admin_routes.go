package tournament

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// AdminCrudRoutes are the uniform admin CRUD endpoints served by the generic
// CRUD engine (rpc.tournament.admin.{create,get,update,delete,list}). All require
// an authenticated user; per-resource workspace permission is enforced in the
// worker. Non-uniform admin endpoints (status/bulk/stage-workflows/jobs/challonge/
// sheets/registration/registration-status) are bespoke and still proxied (Phase 3).
var AdminCrudRoutes = []edge.RouteSpec{
	// tournament
	{Method: "POST", Pattern: "/api/v1/admin/tournaments", Queue: "rpc.tournament.admin.create", Entity: "tournament", Action: "create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "GET", Pattern: "/api/v1/admin/tournaments/{tournament_id}", Queue: "rpc.tournament.admin.get", Entity: "tournament", Action: "get", IDParam: "tournament_id", Auth: edge.AuthRequired},
	{Method: "PATCH", Pattern: "/api/v1/admin/tournaments/{tournament_id}", Queue: "rpc.tournament.admin.update", Entity: "tournament", Action: "update", IDParam: "tournament_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/tournaments/{tournament_id}", Queue: "rpc.tournament.admin.delete", Entity: "tournament", Action: "delete", IDParam: "tournament_id", Auth: edge.AuthRequired, Success: 204},
	// Tournament cover/logo: the delete is a typed method (the paired upload is
	// multipart, served by binary.go + BinaryDocRoutes). IDParam and Path are
	// additive in edge.Dispatcher.serve, so the payload carries BOTH the worker's
	// "id" (from {tournament_id}) and "slot" verbatim.
	{Method: "DELETE", Pattern: "/api/v1/admin/tournaments/{tournament_id}/images/{slot}", Queue: "rpc.tournament.tournaments.image_delete", IDParam: "tournament_id", Path: []string{"slot"}, Auth: edge.AuthRequired},
	// team
	{Method: "POST", Pattern: "/api/v1/admin/teams", Queue: "rpc.tournament.admin.create", Entity: "team", Action: "create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "GET", Pattern: "/api/v1/admin/teams/{team_id}", Queue: "rpc.tournament.admin.get", Entity: "team", Action: "get", IDParam: "team_id", Auth: edge.AuthRequired},
	{Method: "PATCH", Pattern: "/api/v1/admin/teams/{team_id}", Queue: "rpc.tournament.admin.update", Entity: "team", Action: "update", IDParam: "team_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/teams/{team_id}", Queue: "rpc.tournament.admin.delete", Entity: "team", Action: "delete", IDParam: "team_id", Auth: edge.AuthRequired, Success: 204},
	// Team logo: the delete is a typed method (no Entity/Action — not the generic
	// CRUD engine); the paired upload is multipart, served by the binary handler
	// (binary.go + BinaryDocRoutes).
	{Method: "DELETE", Pattern: "/api/v1/admin/teams/{team_id}/image", Queue: "rpc.tournament.teams.image_delete", IDParam: "team_id", Auth: edge.AuthRequired},
	// player
	{Method: "POST", Pattern: "/api/v1/admin/players", Queue: "rpc.tournament.admin.create", Entity: "player", Action: "create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "PATCH", Pattern: "/api/v1/admin/players/{player_id}", Queue: "rpc.tournament.admin.update", Entity: "player", Action: "update", IDParam: "player_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/players/{player_id}", Queue: "rpc.tournament.admin.delete", Entity: "player", Action: "delete", IDParam: "player_id", Auth: edge.AuthRequired, Success: 204},
	// NOTE: all /admin/stages/* routing (stage CRUD + stage_item/input + workflows) is in
	// StageSubtreeRoutes (stage_admin_routes.go), served via edge.Subtree — their patterns
	// are ambiguous under stdlib ServeMux.
	// encounter
	{Method: "POST", Pattern: "/api/v1/admin/encounters", Queue: "rpc.tournament.admin.create", Entity: "encounter", Action: "create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "PATCH", Pattern: "/api/v1/admin/encounters/{encounter_id}", Queue: "rpc.tournament.admin.update", Entity: "encounter", Action: "update", IDParam: "encounter_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/encounters/{encounter_id}", Queue: "rpc.tournament.admin.delete", Entity: "encounter", Action: "delete", IDParam: "encounter_id", Auth: edge.AuthRequired, Success: 204},
	// standing
	{Method: "PATCH", Pattern: "/api/v1/admin/standings/{standing_id}", Queue: "rpc.tournament.admin.update", Entity: "standing", Action: "update", IDParam: "standing_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/standings/{standing_id}", Queue: "rpc.tournament.admin.delete", Entity: "standing", Action: "delete", IDParam: "standing_id", Auth: edge.AuthRequired, Success: 204},
	// player_sub_role
	{Method: "GET", Pattern: "/api/v1/admin/player-sub-roles", Queue: "rpc.tournament.admin.list", Entity: "player_sub_role", Action: "list", Query: []string{"workspace_id", "role", "include_inactive"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/player-sub-roles", Queue: "rpc.tournament.admin.create", Entity: "player_sub_role", Action: "create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "PATCH", Pattern: "/api/v1/admin/player-sub-roles/{sub_role_id}", Queue: "rpc.tournament.admin.update", Entity: "player_sub_role", Action: "update", IDParam: "sub_role_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/player-sub-roles/{sub_role_id}", Queue: "rpc.tournament.admin.delete", Entity: "player_sub_role", Action: "delete", IDParam: "sub_role_id", Auth: edge.AuthRequired, Success: 204},
	// tournament_link
	{Method: "GET", Pattern: "/api/v1/admin/tournament-links", Queue: "rpc.tournament.admin.list", Entity: "tournament_link", Action: "list", Query: []string{"tournament_id", "active_only"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/tournament-links", Queue: "rpc.tournament.admin.create", Entity: "tournament_link", Action: "create", Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "PATCH", Pattern: "/api/v1/admin/tournament-links/{link_id}", Queue: "rpc.tournament.admin.update", Entity: "tournament_link", Action: "update", IDParam: "link_id", Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/tournament-links/{link_id}", Queue: "rpc.tournament.admin.delete", Entity: "tournament_link", Action: "delete", IDParam: "link_id", Auth: edge.AuthRequired, Success: 204},
}
