# Stream Service

Live-stream discovery for tournaments: which Twitch channels — the organizer's official
broadcast and the participants' own POV streams — are on air right now. See
[`../../docs/architecture.md`](../../docs/architecture.md) for how it fits into the wider
platform.

The service ships as **one headless FastStream (RabbitMQ) process** — there is no HTTP
server, no `main.py`, and no uvicorn port. External traffic reaches it as `/api/streams/*`
through the Go gateway, which translates each route to its `rpc.stream.*` queue.

## Processes

| compose service | entry point | run command | responsibility |
|---|---|---|---|
| `stream-svc` | `serve.py` | `faststream run serve:app` | Hosts every `rpc.stream.*` subscriber (public tournament-streams read + the admin re-poll) and runs the APScheduler live-status poll tick. |

Do not scale `stream-svc` past one replica for the poller's sake alone — the tick is
Redis leader-locked, so extra replicas are safe but idle for polling; they only add RPC
consumer capacity.

## Write boundary

The service **writes** to exactly two places:

- **Redis** — the live-status snapshot (`stream:live:{tournament_id}`), the cached Twitch
  app access token (`stream:token`), and the poll heartbeat (`stream:poll:last_run`).
  There is no `streams` Postgres schema: live status is a fact with a lifetime measured in
  seconds, and a table would only add a write path and a migration to maintain.
- **`public.audit_log`** — via `shared.services.audit.record_audit`, for the admin re-poll.

Everything else it touches — `tournament.*`, `players.*`, `balancer.registration` — is
**read-only**. See [`../docs/tournament-service-write-path-inventory.md`](../docs/tournament-service-write-path-inventory.md)
for the boundary rule.

## Local run

```bash
faststream run serve:app
```

## Dependencies

- **Postgres (read-only)** — `tournament.tournament`, `tournament.tournament_link`,
  `balancer.registration`, `players.social_account` (+ `social_account_visibility`).
- **Redis** — live-status snapshots, Helix token cache, scheduler leader lock, and the
  `tournament:{id}:streams` realtime topic the gateway relays to WebSocket clients.
- **RabbitMQ** — `rpc.stream.*` transport.
- **Twitch Helix** — `GET /streams` under an app access token (client-credentials).
  The app bucket (800 points/min) is **shared with identity-service**, which uses the same
  Twitch application for OAuth login.

## Configuration & environment

See `backend/env/stream.env` (template: `stream.env.example`), which inherits
`backend/env/common.env`. `WORKER_METRICS_PORT` (9111) exposes Prometheus metrics only —
it is not an HTTP API.

Operational knobs — whether polling runs at all, how often, and the Helix batch size —
live in the admin `Settings` table under the `stream.collection` key, **not** in env.
It defaults to `enabled=false`, so a fresh deploy never touches Twitch until an operator
turns it on.
