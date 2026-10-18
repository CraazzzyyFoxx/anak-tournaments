// Package stats holds the gateway route table for stats-service, translated to
// typed RPC via the shared edge.Dispatcher. The table is data; the dispatcher is
// generic.
//
// Stats-unique domains are folded into the unified /api/v1/* namespace (match-log
// admin, OverFast rank, subscription collection, achievement engine + rules admin,
// catalog sync, settings, discord-channel, bootstrap importers). The
// worker's RPC queues are path-independent, so the external paths are clean
// /api/v1/* with no /api/stats prefix. Un-migrated stats endpoints still proxy
// to stats-service on their original addresses.
package stats

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// Routes are the migrated stats endpoints (typed RPC). Permission gating is
// enforced in the worker handlers; AuthRequired here injects identity + rejects
// anonymous callers (mirroring the route dependencies).
var Routes = []edge.RouteSpec{
	// match-log admin (src/routes/admin/logs.py); JSON reads/writes.
	{Method: "GET", Pattern: "/api/v1/admin/logs/queue-status", Queue: "rpc.stats.logs.queue_status", Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/logs/history", Queue: "rpc.stats.logs.history", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/logs/stats", Queue: "rpc.stats.logs.stats", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/logs/{id}/retry", Queue: "rpc.stats.logs.retry", IDParam: "id", Body: true, Auth: edge.AuthRequired},
	// Admin bind of an awaiting_link job to a game with the operator's complete team map (src/rpc/ingest.py).
	// The target game's authoritative current observation (the bind's expected_revision), src/rpc/ingest.py.
	{Method: "GET", Pattern: "/api/v1/admin/logs/games/{id}/observation", Queue: "rpc.stats.ingest.game_observation", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/logs/{id}/bind", Queue: "rpc.stats.ingest.bind", IDParam: "id", Body: true, Auth: edge.AuthRequired},
	// match-log enqueue (src/routes/match_logs.py); admin-role gated in the handler.
	{Method: "POST", Pattern: "/api/v1/logs/{id}", Queue: "rpc.stats.logs.process_tournament", IDParam: "id", Auth: edge.AuthRequired},

	// OverFast rank history (src/routes/rank_history.py); public reads.
	{Method: "GET", Pattern: "/api/v1/users/{id}/rank-history", Queue: "rpc.stats.rank.user_history", IDParam: "id", AllQuery: true, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/users/{id}/current-ranks", Queue: "rpc.stats.rank.user_current", IDParam: "id", Query: []string{"platform"}, Auth: edge.AuthNone},
	{Method: "GET", Pattern: "/api/v1/battle-tags/{id}/rank-history", Queue: "rpc.stats.rank.battle_tag_history", IDParam: "id", AllQuery: true, Auth: edge.AuthNone},

	// OverFast rank collection admin (src/rpc/rank.py); rank.read / rank.update,
	// where `workspace_id` is both the authorization scope and the data filter
	// (rank rows reach a workspace through the tag's player) — so it must reach
	// the handler on every one of these.
	{Method: "GET", Pattern: "/api/v1/admin/rank/stats", Queue: "rpc.stats.rank.stats", Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/rank/fetch-log", Queue: "rpc.stats.rank.fetch_log", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/rank/users/{id}/collection", Queue: "rpc.stats.rank.user_collection", IDParam: "id", Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/rank/collect", Queue: "rpc.stats.rank.collect", Body: true, Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/rank/reenable-disabled", Queue: "rpc.stats.rank.reenable_disabled", Body: true, Query: []string{"workspace_id"}, Auth: edge.AuthRequired},

	// Subscription collection admin (src/rpc/subscription.py); subscription.read /
	// subscription.update, where `workspace_id` is both the authorization scope and
	// the data filter — so it must reach the handler on every one of these.
	{Method: "GET", Pattern: "/api/v1/admin/subscriptions/stats", Queue: "rpc.stats.subscription.stats", Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/subscriptions/check-log", Queue: "rpc.stats.subscription.check_log", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/subscriptions/users/{id}/collection", Queue: "rpc.stats.subscription.user_collection", IDParam: "id", Query: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/subscriptions/collect", Queue: "rpc.stats.subscription.collect", Body: true, Query: []string{"workspace_id"}, Auth: edge.AuthRequired},

	// Achievement calculate (src/routes/achievement.py); global admin role in the handler.
	{Method: "POST", Pattern: "/api/v1/achievement/calculate", Queue: "rpc.stats.ach.calculate", Body: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/achievement/calculate/{tournament_id}", Queue: "rpc.stats.ach.calculate_tournament", Path: []string{"tournament_id"}, Body: true, Auth: edge.AuthRequired},

	// Catalog sync of one discipline from its module's source (OverFast, Data Dragon); superuser in the handler.
	{Method: "POST", Pattern: "/api/v1/admin/catalog-sync/{discipline}", Queue: "rpc.stats.catalog.sync", Path: []string{"discipline"}, Auth: edge.AuthRequired},

	// Global settings (src/routes/admin/settings.py); superuser in the handler.
	{Method: "GET", Pattern: "/api/v1/admin/settings", Queue: "rpc.stats.settings.list", Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/settings/{key}", Queue: "rpc.stats.settings.get", Path: []string{"key"}, Auth: edge.AuthRequired},
	{Method: "PUT", Pattern: "/api/v1/admin/settings/{key}", Queue: "rpc.stats.settings.upsert", Path: []string{"key"}, Body: true, Auth: edge.AuthRequired},

	// Per-tournament Discord channel (src/routes/admin/discord_channel.py); discord_channel perm.
	{Method: "GET", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel", Queue: "rpc.stats.discord_channel.get", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel", Queue: "rpc.stats.discord_channel.upsert", IDParam: "id", Body: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel/backfill", Queue: "rpc.stats.discord_channel.backfill", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel", Queue: "rpc.stats.discord_channel.delete", IDParam: "id", Auth: edge.AuthRequired, Success: 204},
}

// AchievementAdminRoutes are the workspace-scoped achievement rule/library/override
// admin endpoints (src/routes/admin/achievement_rule.py), served via the ordered
// edge.Subtree matcher under /api/v1/admin/ws/ (literal segments like
// rules/export collide with rules/{rule_id} under the stdlib ServeMux). ORDER
// MATTERS: literal routes precede the {rule_id} catch-alls. All require auth;
// the workspace "achievement.<action>" permission is enforced in each handler.
var AchievementAdminRoutes = []edge.RouteSpec{
	// --- rules: literal segments first ---
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/condition-types", Queue: "rpc.stats.ach.condition_types", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/validate", Queue: "rpc.stats.ach.validate", Path: []string{"workspace_id"}, Body: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/seed", Queue: "rpc.stats.ach.seed", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/reset", Queue: "rpc.stats.ach.reset", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/export", Queue: "rpc.stats.ach.export", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/import", Queue: "rpc.stats.ach.import", Path: []string{"workspace_id"}, Body: true, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/runs", Queue: "rpc.stats.ach.runs", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/evaluate", Queue: "rpc.stats.ach.evaluate", Path: []string{"workspace_id"}, Body: true, Auth: edge.AuthRequired},
	// --- rules: {rule_id}/<sub> (2-segment) ---
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/{rule_id}/users", Queue: "rpc.stats.ach.rule_users", Path: []string{"workspace_id", "rule_id"}, AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/{rule_id}/test", Queue: "rpc.stats.ach.test", Path: []string{"workspace_id", "rule_id"}, Query: []string{"tournament_id"}, Auth: edge.AuthRequired},
	// --- rules: {rule_id} catch-alls ---
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/{rule_id}", Queue: "rpc.stats.ach.get", Path: []string{"workspace_id", "rule_id"}, Auth: edge.AuthRequired},
	{Method: "PATCH", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/{rule_id}", Queue: "rpc.stats.ach.update", Path: []string{"workspace_id", "rule_id"}, Body: true, Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules/{rule_id}", Queue: "rpc.stats.ach.delete", Path: []string{"workspace_id", "rule_id"}, Auth: edge.AuthRequired, Success: 204},
	// --- rules: collection (list/create) ---
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules", Queue: "rpc.stats.ach.list", Path: []string{"workspace_id"}, AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/rules", Queue: "rpc.stats.ach.create", Path: []string{"workspace_id"}, Body: true, Auth: edge.AuthRequired, Success: 201},
	// --- library ---
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/library/workspaces", Queue: "rpc.stats.ach.lib_workspaces", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/library", Queue: "rpc.stats.ach.lib_list", Path: []string{"workspace_id"}, Query: []string{"source_workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/library/import", Queue: "rpc.stats.ach.lib_import", Path: []string{"workspace_id"}, Body: true, Auth: edge.AuthRequired},
	// --- overrides ---
	{Method: "GET", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/overrides", Queue: "rpc.stats.ach.overrides_list", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/overrides", Queue: "rpc.stats.ach.override_create", Path: []string{"workspace_id"}, Body: true, Auth: edge.AuthRequired, Success: 201},
	{Method: "DELETE", Pattern: "/api/v1/admin/ws/{workspace_id}/achievements/overrides/{override_id}", Queue: "rpc.stats.ach.override_delete", Path: []string{"workspace_id", "override_id"}, Auth: edge.AuthRequired, Success: 204},
}
