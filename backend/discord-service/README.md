# Discord Service

Discord bot integration for OWT. It connects the platform to a Discord server for match-log
ingestion, notifications, commands, and other community-facing interactions. See
[`../../docs/architecture.md`](../../docs/architecture.md) for how it fits into the wider platform.

This is the **discord-worker** (compose service `discord`, profile `workers`): a long-running
[discord.py](https://discordpy.readthedocs.io/) bot that **also** acts as a FastStream (RabbitMQ)
consumer. It has no HTTP server.

- **Entry point:** `main.py` (`python main.py`)
- **Compose service:** `discord` (profile `workers`)

## Architecture

`LogCollectorBot` (`src/bot.py`) is a `discord.ext.commands.Bot` subclass that wires together:

- **Cogs** (`src/cogs/`) — gateway event listeners:
  - `LogIngestionCog` — monitored-channel message/edit handling, the periodic channel-list
    reload (`discord.ext.tasks.loop`), and the startup history rescan.
  - `MembershipEventsCog` — guild join/leave logging and member-join/leave/role-update →
    instant subscription resync.
- **Services** (`src/services/`) — plain classes holding the business logic, independent of
  discord.py wiring:
  - `ChannelRegistry` — the active `channel_id -> tournament_id` cache and its DB-backed reload.
  - `AttachmentProcessor` — the log-upload pipeline (download, dedupe, publish, feedback).
  - `DiscordDirectoryService` — guild/member introspection served over RPC.
  - `MemberSubscriptionSyncService` — Discord-event-triggered subscription re-evaluation.
  - `ParserClientFactory` / `ServiceTokenClient` — HTTP access to the parser service.
- **`DiscordRabbitGateway`** (`src/rabbit/gateway.py`) — owns the RabbitMQ broker's lifecycle
  and every subscriber, delegating to the services above.

All database access goes through `shared.repository` (`DiscordChannelRepository`,
`LogProcessingRepository`, `WorkspaceRepository`, `OAuthConnectionRepository`) — no ad hoc
SQLAlchemy queries in the bot's own code.

## Responsibilities

- **Watch active tournament channels** and pick up match-log attachments.
- **Upload match logs to the parser** by base64-encoding attachments and publishing them to
  RabbitMQ (`UPLOAD_MATCH_LOG_QUEUE`).
- **Receive parse results** over a fanout exchange (`MATCH_LOG_RESULT_EXCHANGE`, per-replica
  exclusive queue) resolved by `ResultWaiter` — which replaces pg `LISTEN`/`NOTIFY` (broken by
  pgBouncer transaction pooling) — and reacts on the originating Discord message.
- **Handle Discord commands** consumed from `DISCORD_COMMANDS_QUEUE`.
- **Deliver tournament/registration notifications** to Discord.

## Authentication

The bot obtains a **cached service token via the gateway** at `/api/auth` using client-credentials
(`SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET`) and uses it for internal calls.

## Running

```bash
# Local
python main.py

# Docker (workers profile)
docker compose --profile workers up -d discord
```

## Dependencies

- **Discord API** and **OverFast** — reached through the outbound egress proxy.
- **Postgres** — active tournament channels and log-processing records.
- **Redis** — shared caches/state.
- **RabbitMQ** — match-log uploads, result fanout, and command queue.

## Configuration & environment

See `backend/env/discord.env`, which inherits `backend/env/common.env`. Required settings include the
Discord bot token, the service client credentials (`SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET`), and an
optional outbound proxy (`PROXY_HOST` / `PROXY_PORT`).
