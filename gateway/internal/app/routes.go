// Package app holds the gateway route table for app-service (compose `backend`),
// translated to typed RPC via the shared edge.Dispatcher. The table is data; the
// dispatcher is generic. Specific patterns here win over the /api/v1 reverse
// proxy by ServeMux specificity, so endpoints cut over to RPC incrementally.
//
// app-service is served externally under /api/v1/* (FastAPI root_path), so
// every pattern keeps that prefix verbatim — the frontend is unchanged.
//
// Every read is a bespoke rpc.app.<domain>.<method> subscriber; all are public
// (AuthNone or AuthOptional). Player statistics, profile and achievement reads
// are stats-service's (stats.PublicReadRoutes, stats.AchievementsSubtreeRoutes).
package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// ReadRoutes are flat (non-ambiguous) public read endpoints.
var ReadRoutes = []edge.RouteSpec{
	// --- catalog: one discipline's characters/maps/modes, public, never cached (P7 §3.2) ---
	{Method: "GET", Pattern: "/api/v1/catalog/{discipline}/{kind}", Queue: "rpc.app.catalog.list", Path: []string{"discipline", "kind"}, AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/catalog/{discipline}/{kind}/{id}", Queue: "rpc.app.catalog.get", IDParam: "id", Path: []string{"discipline", "kind"}, Auth: edge.AuthNone},
	// --- disciplines: installed descriptors and native metadata; AuthOptional so a hidden workspace's members may read
	// its ontology, never cached (P7 §1.1) ---
	{Method: "GET", Pattern: "/api/v1/disciplines", Queue: "rpc.app.disciplines.list", Query: []string{"workspace_id"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/disciplines/{discipline}/metadata", Queue: "rpc.app.disciplines.metadata", Path: []string{"discipline"}, Query: []string{"workspace_id"}, Auth: edge.AuthOptional},
	// --- workspaces (public reads; writes + members in Phase 2) -------------
	// list takes ?scope=public|admin|all (default public — the shared home-page
	// directory: no hidden, no unverified, superusers included). admin/all
	// recognise the viewer: their own workspaces surface at any tier
	// (app-service/src/services/workspace/service.py:get_all).
	{Method: "GET", Pattern: "/api/v1/workspaces", Queue: "rpc.app.workspaces.list", Query: []string{"scope"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/workspaces/by-host", Queue: "rpc.app.workspaces.by_host", Query: []string{"host"}, Auth: edge.AuthNone},
	// The community page: one workspace by slug under the list's scope=all visibility, so AuthOptional.
	{Method: "GET", Pattern: "/api/v1/workspaces/by-slug", Queue: "rpc.app.workspaces.by_slug", Query: []string{"slug"}, Auth: edge.AuthOptional},
	{Method: "GET", Pattern: "/api/v1/workspaces/{id}", Queue: "rpc.app.workspaces.get", IDParam: "id", Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/workspaces/{workspace_id}/staff", Queue: "rpc.app.workspaces.staff", Path: []string{"workspace_id"}, Auth: edge.AuthNone},
	// --- users directory + bare /{name} slug resolution (the /overview* and /{id}/... player reads are
	// stats.PublicReadRoutes; ServeMux specificity keeps those literals ahead of /{name}) ---
	{Method: "GET", Pattern: "/api/v1/users", Queue: "rpc.app.users.list", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/search", Queue: "rpc.app.users.search", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{name}", Queue: "rpc.app.users.by_name", Path: []string{"name"}, Query: []string{"entities"}, Auth: edge.AuthNone},
}
