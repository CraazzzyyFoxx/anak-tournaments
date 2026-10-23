package app

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/respcache"

// PublicCacheableReads opts app-service ReadRoutes into the gateway's
// anonymous response cache (see internal/respcache). The player statistics,
// profile and achievement reads are stats-service's, cached by
// stats.PublicCacheableReads.
//
// Deliberately NOT cached:
//   - /users, /users/search — the users directory; large paginated surface
//     with attacker-controlled query space, low anonymous re-hit rate per
//     exact URL.
//   - /workspaces/by-host — feeds tenant-origin resolution (middleware/SSO
//     paths); correctness there must never lag an admin domain change.
var PublicCacheableReads = map[string]respcache.Rule{
	// Home page: communities section.
	"/api/v1/workspaces": {Extract: respcache.TTLOnly()},
	// The workspace page's staff block. TTLOnly like the directory above: the
	// resource manifest publishes nothing for workspace membership or RBAC
	// (see respcache/resources.go), so there is no invalidation signal to key
	// on and a role change surfaces within the TTL.
	"/api/v1/workspaces/{workspace_id}/staff": {Extract: respcache.TTLOnly()},
	// /users/[slug] page: slug resolution (the profile tabs are
	// stats.PublicCacheableReads). TTLOnly: there is no per-user realtime signal.
	"/api/v1/users/{name}": {Extract: respcache.TTLOnly()},
}
