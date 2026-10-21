"""Human-readable docs (summary + description) for discord-service RPC subjects,
merged into the gateway's OpenAPI by the export script. Prose only.
"""

from __future__ import annotations

DOCS: dict[str, dict] = {
    # ── a workspace's linked Discord server ──────────────────────────────────
    "rpc.discord.workspace_roles": {
        "summary": "List workspace Discord roles",
        "description": "Permission: workspace `workspace.update`. Returns `{guild_id, roles}`: the roles of the workspace's linked Discord server with names, colors and positions, highest first, from the bot's gateway cache. `guild_id` is null and `roles` empty when no server is linked; when the bot cannot read the server the list is empty and `error` carries a code (`guild_not_found`, `discord_error`) instead of failing the call.",
    },
    "rpc.discord.workspace_channels": {
        "summary": "List workspace Discord channels",
        "description": "Permission: workspace `workspace.update`. Returns `{guild_id, channels}`: the text, voice and category channels of the workspace's linked Discord server with their categories and, for voice and categories, the permissions the bot lacks to move members. `guild_id` is null and `channels` empty when no server is linked; when the bot cannot read the server the list is empty and `error` carries a code (`guild_not_found`, `discord_error`) instead of failing the call.",
    },
    "rpc.discord.workspace_guild": {
        "summary": "Workspace Discord server status",
        "description": "Permission: workspace `workspace.update`. Returns connection status, server name, icon URL, member count, and Discord owner of the workspace's linked Discord server. With no server linked `connected` is false and the rest null; when the bot cannot read the server the answer is `{guild_id, connected: false, error}` with a code (`guild_not_found`, `discord_error`).",
    },
    # ── per-tournament Discord channel ────────────────────────────────────────
    "rpc.discord.channel.get": {
        "summary": "Get tournament Discord channel",
        "description": "Permission: workspace `discord_channel.read` in the tournament's workspace. Returns the Discord channel configuration for a tournament (or null).",
    },
    "rpc.discord.channel.upsert": {
        "summary": "Upsert tournament Discord channel",
        "description": "Permission: workspace `discord_channel.update` in the tournament's workspace. Creates or updates the tournament's match-log channel binding; the bot starts or stops watching it at once. The channel must be a text channel of the workspace's linked Discord server: 409 `discord_guild_not_linked` when the workspace has none, 422 `discord_channel_not_in_guild` otherwise, 503 `discord_unavailable` when Discord could not be asked.",
    },
    "rpc.discord.channel.backfill": {
        "summary": "Backfill Discord channel history",
        "description": "Permission: workspace `discord_channel.update` in the tournament's workspace. Starts a rescan of the last 500 messages of the tournament's active Discord channel, resubmitting every log attachment found; returns an ack immediately, the scan itself is asynchronous, and 404s when no active channel is configured. Ingestion deduplicates on the SHA-256 of a log file's bytes, so logs already processed for the tournament are skipped rather than duplicated, but each call re-downloads and re-uploads every attachment — repeat it only when logs are genuinely missing.",
    },
    "rpc.discord.channel.delete": {
        "summary": "Delete tournament Discord channel",
        "description": "Permission: workspace `discord_channel.delete` in the tournament's workspace. Removes a tournament's Discord channel configuration and returns no content, 404ing when no channel is configured.",
    },
}
