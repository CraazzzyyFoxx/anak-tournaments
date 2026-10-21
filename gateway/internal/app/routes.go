// Package app holds the gateway route table for app-service (compose `backend`),
// translated to typed RPC via the shared edge.Dispatcher. The table is data; the
// dispatcher is generic. Specific patterns here win over the /api/v1 reverse
// proxy by ServeMux specificity, so endpoints cut over to RPC incrementally.
//
// app-service is served externally under /api/v1/* (FastAPI root_path), so
// every pattern keeps that prefix verbatim — the frontend is unchanged.
//
// achievement get+list go through the shared CRUD read engine
// (rpc.app.read.{get,list} with Entity set, public_read=True). Everything else is
// a bespoke rpc.app.<domain>.<method> subscriber. All reads are public (AuthNone).
package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// ReadRoutes are flat (non-ambiguous) public read endpoints. Achievements' get
// surface is in AchievementsSubtreeRoutes (ServeMux can't disambiguate
// /{id}/users vs /user/{user_id}); the achievements *list* stays here.
var ReadRoutes = []edge.RouteSpec{
	// --- one discipline's character and map statistics (the catalog reads are the native /api/v1/catalog routes below).
	// Four to six segments: no clash with the three-segment /statistics/{champion,winrate,players,records} literals. ---
	{Method: "GET", Pattern: "/api/v1/statistics/{discipline}/characters/playtime", Queue: "rpc.app.statistics.character_playtime", Path: []string{"discipline"}, AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/statistics/{discipline}/characters/{entity_id}/leaderboard", Queue: "rpc.app.statistics.character_leaderboard", IDParam: "entity_id", Path: []string{"discipline"}, AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/statistics/{discipline}/maps", Queue: "rpc.app.statistics.maps", Path: []string{"discipline"}, Query: []string{"workspace_id"}, Auth: edge.AuthNone},
	// --- catalog: one discipline's characters/maps/modes, public, never cached (P7 §3.2) ---
	{Method: "GET", Pattern: "/api/v1/catalog/{discipline}/{kind}", Queue: "rpc.app.catalog.list", Path: []string{"discipline", "kind"}, AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/catalog/{discipline}/{kind}/{id}", Queue: "rpc.app.catalog.get", IDParam: "id", Path: []string{"discipline", "kind"}, Auth: edge.AuthNone},
	// --- disciplines: installed descriptors and native metadata; AuthOptional so a hidden workspace's members may read
	// its ontology, never cached (P7 §1.1) ---
	{Method: "GET", Pattern: "/api/v1/disciplines", Queue: "rpc.app.disciplines.list", Query: []string{"workspace_id"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/disciplines/{discipline}/metadata", Queue: "rpc.app.disciplines.metadata", Path: []string{"discipline"}, Query: []string{"workspace_id"}, Auth: edge.AuthOptional},
	// --- achievements (list only; get surface is the subtree) ---------------
	{Method: "GET", Pattern: "/api/v1/achievements", Queue: "rpc.app.read.list", Entity: "achievement", Action: "list", AllQuery: true, Auth: edge.AuthNone},
	// --- statistics ---------------------------------------------------------
	{Method: "GET", Pattern: "/api/v1/statistics/champion", Queue: "rpc.app.statistics.champion", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/statistics/winrate", Queue: "rpc.app.statistics.winrate", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/statistics/players", Queue: "rpc.app.statistics.players", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/statistics/records", Queue: "rpc.app.statistics.records", Query: []string{"discipline", "workspace_id"}, Auth: edge.AuthNone},
	// --- workspaces (public reads; writes + members in Phase 2) -------------
	// list takes ?scope=public|admin|all (default public — the shared home-page
	// directory: no hidden, no unverified, superusers included). admin/all
	// recognise the viewer: their own workspaces surface at any tier
	// (app-service/src/services/workspace/service.py:get_all).
	{Method: "GET", Pattern: "/api/v1/workspaces", Queue: "rpc.app.workspaces.list", Query: []string{"scope"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/workspaces/by-host", Queue: "rpc.app.workspaces.by_host", Query: []string{"host"}, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/workspaces/{id}", Queue: "rpc.app.workspaces.get", IDParam: "id", Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/workspaces/{workspace_id}/staff", Queue: "rpc.app.workspaces.staff", Path: []string{"workspace_id"}, Auth: edge.AuthNone},
	// --- users (literals + /{id}/... + bare /{name} last) -------------------
	{Method: "GET", Pattern: "/api/v1/users", Queue: "rpc.app.users.list", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/search", Queue: "rpc.app.users.search", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/overview", Queue: "rpc.app.users.overview", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/overview/stats", Queue: "rpc.app.users.overview_stats", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/overview/catalog", Queue: "rpc.app.users.overview_catalog", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{id}/compare", Queue: "rpc.app.users.compare", IDParam: "id", AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/compare/characters", Queue: "rpc.app.users.compare_characters", IDParam: "id", AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/profile", Queue: "rpc.app.users.get_profile", IDParam: "id", Query: []string{"workspace_id", "discipline"}, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{id}/draft-card", Queue: "rpc.app.users.draft_card", IDParam: "id", Query: []string{"workspace_id", "discipline"}, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{id}/tournaments", Queue: "rpc.app.users.tournaments", IDParam: "id", Query: []string{"workspace_id", "discipline"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/tournaments/{tournament_id}", Queue: "rpc.app.users.tournament", IDParam: "id", Path: []string{"tournament_id"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/tournaments/{tournament_id}/encounters", Queue: "rpc.app.users.tournament_encounters", IDParam: "id", Path: []string{"tournament_id"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/tournaments/{tournament_id}/leaderboard", Queue: "rpc.app.users.tournament_leaderboard", IDParam: "id", Path: []string{"tournament_id"}, Query: []string{"stat"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/maps", Queue: "rpc.app.users.maps", IDParam: "id", AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/maps/summary", Queue: "rpc.app.users.maps_summary", IDParam: "id", AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/encounters", Queue: "rpc.app.users.encounters", IDParam: "id", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{id}/matches/summary", Queue: "rpc.app.users.matches_summary", IDParam: "id", Query: []string{"workspace_id", "discipline"}, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{id}/characters", Queue: "rpc.app.users.characters", IDParam: "id", AllQuery: true, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/users/{id}/teammates", Queue: "rpc.app.users.teammates", IDParam: "id", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{name}", Queue: "rpc.app.users.by_name", Path: []string{"name"}, Query: []string{"entities"}, Auth: edge.AuthNone},
}
