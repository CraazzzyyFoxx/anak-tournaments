// Package discord holds the gateway route table for discord-service (the bot),
// translated to typed RPC via the shared edge.Dispatcher. The table is data; the
// dispatcher is generic.
//
// The bot is the only process that talks to Discord (OAuth in identity-service
// excepted), so every HTTP read of guild state and every write of a tournament's
// match-log channel binding lands here. The external paths predate the move and
// did not change; only the subjects did.
package discord

import "github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"

// Routes are the bot's HTTP surface (src/rpc_api.py). Permission gating is
// enforced in the worker handlers; AuthRequired here injects identity + rejects
// anonymous callers.
var Routes = []edge.RouteSpec{
	// --- discord entities: read the linked guild's roles, text channels and
	// connection status for the workspace settings pickers. Reads, but gated on
	// workspace.update in the worker like the custom-domain endpoints -- a guild's
	// role and channel names are not public.
	{Method: "GET", Pattern: "/api/v1/workspaces/{workspace_id}/discord/roles", Queue: "rpc.discord.workspace_roles", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/workspaces/{workspace_id}/discord/channels", Queue: "rpc.discord.workspace_channels", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},
	{Method: "GET", Pattern: "/api/v1/workspaces/{workspace_id}/discord/guild", Queue: "rpc.discord.workspace_guild", Path: []string{"workspace_id"}, Auth: edge.AuthRequired},

	// Per-tournament Discord channel (match-log ingestion); discord_channel perm.
	{Method: "GET", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel", Queue: "rpc.discord.channel.get", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel", Queue: "rpc.discord.channel.upsert", IDParam: "id", Body: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel/backfill", Queue: "rpc.discord.channel.backfill", IDParam: "id", Auth: edge.AuthRequired},
	{Method: "DELETE", Pattern: "/api/v1/admin/tournaments/{id}/discord-channel", Queue: "rpc.discord.channel.delete", IDParam: "id", Auth: edge.AuthRequired, Success: 204},
}
