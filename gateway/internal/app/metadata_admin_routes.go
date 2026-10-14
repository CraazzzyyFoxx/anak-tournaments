package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// MetadataAdminRoutes are the game-catalog admin CRUD endpoints
// (catalog.entity, one surface by discipline and kind). All require auth;
// superuser-only access is enforced in the worker handler.
var MetadataAdminRoutes = []edge.RouteSpec{
	// game catalog: one admin CRUD by discipline and kind (catalog.entity, D85).
	{Method: "GET", Pattern: "/api/v1/admin/catalog/{discipline}/{kind}", Queue: "rpc.app.catalog.admin_list", Path: []string{"discipline", "kind"}, AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/catalog/{discipline}/{kind}", Queue: "rpc.app.catalog.admin_create", Path: []string{"discipline", "kind"}, Body: true, Auth: edge.AuthRequired},
	{Method: "PATCH", Pattern: "/api/v1/admin/catalog/{discipline}/{kind}/{id}", Queue: "rpc.app.catalog.admin_update", IDParam: "id", Path: []string{"discipline", "kind"}, Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/catalog/{discipline}/{kind}/{id}", Queue: "rpc.app.catalog.admin_delete", IDParam: "id", Path: []string{"discipline", "kind"}, Auth: edge.AuthRequired, Success: 204},
	// alias-miss queue: catalog names a match log used that no alias resolved.
	// `attach` is a bespoke write rather than a PATCH on the entity's `aliases`
	// so the browser never read-modify-writes the array (two admins would race)
	// and closing the miss rides the same transaction.
	{Method: "GET", Pattern: "/api/v1/admin/catalog-aliases/misses", Queue: "rpc.app.catalog_aliases.misses_list", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/catalog-aliases/attach", Queue: "rpc.app.catalog_aliases.attach", Body: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/catalog-aliases/misses/{id}/dismiss", Queue: "rpc.app.catalog_aliases.dismiss", IDParam: "id", Auth: edge.AuthRequired},
	// Platform audit log ("who did this", workspace-scoped, gated by audit.read
	// in the worker). Not game metadata — it rides this table because the table
	// is already registered on the mux in main.go and already carries
	// non-metadata (catalog-aliases above), so the feed costs no new Register.
	// The docs file it under its own tag; see apidocs.Groups.
	{Method: "GET", Pattern: "/api/v1/admin/audit", Queue: "rpc.app.audit_list", AllQuery: true, Auth: edge.AuthRequired},
}
