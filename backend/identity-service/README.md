# Identity Service (identity-svc)

Authentication and authorization for OWT. It exists as its own process because every
authenticated request in the platform passes through it: the gateway calls `validate_token` on
the hot path, so identity is sized, cached and deployed independently of the domain services.
It is a **headless FastStream (RabbitMQ) RPC worker** — there is no HTTP server and no listening
API port. All requests arrive as typed request/reply RPC (`rpc.identity.*`) published by the
[Go gateway](../../docs/architecture.md), which terminates HTTP and exposes this worker's
surface under `/api/auth`.

- **Compose service:** `identity-svc`
- **Entry point:** `serve.py` (headless FastStream RPC worker)
- **Run command:** `faststream run serve:app`
- **Transport:** RabbitMQ request/reply (`rpc.identity.<method>`); no HTTP
- **Metrics:** Prometheus on `WORKER_METRICS_PORT` (dev 9100 — the compose block sets no
  override, so it inherits `common.env`; prod 9107)

See [`../../docs/architecture.md`](../../docs/architecture.md) for the system overview and
request flow, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the `rpc → services → domain →
repository → models` layering, and [`../shared/README.md`](../shared/README.md) for the
ORM/kernel this service builds on.

## Responsibilities

- **JWT auth** — issues and validates access + refresh tokens (python-jose, HS256, shared
  secret). `validate_token` is the gateway's authority for RBAC-gated routes and rehydrates
  the `AuthUser`, permission set and workspace memberships from the request.
- **Sessions** — list, revoke a single session, logout, and logout-all (revoke every session
  for the user). Refresh tokens are persisted in Postgres and revocable; revoking a session
  also blacklists its `sid` in Redis for the remaining access-token lifetime.
- **OAuth** — Discord, Twitch and Battle.net (a provider is advertised only when its enable
  flag is on and all credentials are present): authorization URL, callback exchange, account
  link/unlink, and listing connected providers. State is signed, and the OAuth handoff to
  custom domains is completed via single-use, browser-bound Redis tickets.
- **SSO exchange** — redeems a one-time SSO ticket so a custom-domain OAuth callback can hand
  the session back to the tenant origin without exposing tokens in the redirect.
- **RBAC** — permissions, roles, role↔permission grants, user↔role assignments, and a
  workspace-scoped `user_permission_deny` overlay (grant-only catalog + deny overrides),
  administered through the `rpc.identity.rbac.*` method group.
- **Workspace membership authz** — resolves and authorizes a user's membership within a
  workspace (tenant), feeding the gateway's ACL decisions.
- **Multitenancy** — custom-domain / subdomain tenancy: signed OAuth `state`, single-use Redis
  SSO and link tickets, and tenant-aware callbacks so white-label hosts share one identity
  backend.
- **API keys** — create, list, update, and revoke per-user, workspace-scoped API keys;
  `validate_token` accepts an API key in place of a bearer access token.
- **Player linking** — attach in-game player profiles to an auth user, unlink, list linked
  players, and set the primary player.
- **Avatar** — set/delete the current user's avatar, stored in S3.
- **Service tokens** — client-credentials tokens (`service_token` / `validate_service_token`)
  used by other services (e.g. the Discord bot) to call the platform machine-to-machine.

## Interface

The worker subscribes to a single namespace, `rpc.identity.*`; the gateway publishes a request
per subject and the worker replies with an `{ ok, data, error }` envelope. Requests carry the
gateway's `x-deadline-ms` budget — a request whose deadline has already passed when it reaches
the consumer is acked and dropped without executing. Authenticated methods carry the caller's
bearer `access_token` (injected by the gateway) and resolve the active user before executing.

| Method group | Subjects | What it covers |
|---|---|---|
| Token / service validation | `rpc.identity.validate_token`, `…service_token`, `…validate_service_token`, `…invalidate_session` | Bearer/API-key validation for the gateway, client-credentials tokens, and dropping a user's cached RBAC |
| Auth core & sessions | `rpc.identity.<register\|login\|refresh\|logout…>` | Registration, login, refresh rotation, logout/logout-all, session list and revoke |
| Current user | `rpc.identity.<get_me\|update_me\|…>`, `rpc.identity.me.*` | Profile read/update, self-delete, password set, avatar set/delete |
| OAuth & cross-domain handoff | `rpc.identity.oauth_*`, `rpc.identity.sso_exchange`, `rpc.identity.link_complete` | Provider list, authorization URL, callback, link/unlink, connections, Discord guilds, ticket redemption |
| RBAC admin | `rpc.identity.rbac.*` | Permissions, roles, assignments, deny overlay, auth-user administration, admin views of sessions and OAuth connections |
| Player linking | `rpc.identity.player.*` | Link, unlink, list linked players, set primary |
| API keys | `rpc.identity.<list\|create\|update\|revoke>_api_key`, `rpc.identity.api_key.self` | Per-key lifecycle and self-introspection |

The full method list with request/response schemas is published at `/api/docs`, generated from
`src/openapi_schemas.py` (`OPERATIONS`) and `src/openapi_docs.py` (`DOCS`).

The service consumes only its own RPC queues: it subscribes to no event/job queue, publishes no
domain events or outbox rows, writes no Redis realtime topics, and runs no scheduled work. Every
state change is driven by an inbound RPC call.

## Data owned

Writes the whole `auth` schema: `user`, `refresh_token`, `oauth_connections`, `api_key`,
`api_key_scope`, `permissions`, `roles`, `role_permissions`, `user_roles`, and
`user_permission_deny`.

Also writes parts of `players`: `players.user` (a player row is provisioned at registration and
its `auth_user_id` is set/cleared by linking) and `players.social_account` when an OAuth
identity is claimed or released. Appends to `public.audit_log` for administrative mutations.

Reads only: `public.workspace` and `public.workspace_member` for tenancy and membership
resolution.

Tables live in the shared ORM models and are created by the **central Alembic migrations** at
`backend/migrations/` — this service ships no migrations of its own. See
[`../../docs/database_erd.md`](../../docs/database_erd.md#identity--auth-players) for the entity
diagram.

## Dependencies

- **PostgreSQL** — the single shared database, via the one SQLAlchemy metadata in
  [`../shared/README.md`](../shared/README.md).
- **Redis** — RBAC cache, revoked-session blacklist, refresh idempotency, and the single-use
  SSO / pending-link tickets.
- **RabbitMQ** — the RPC transport (`rpc.identity.*`) and the shared broker topology.
- **S3** — avatar object storage.
- **External APIs** — Discord, Twitch and Battle.net OAuth token/userinfo endpoints, reached
  through the outbound `proxy` container when the shared `PROXY_TYPE` / `PROXY_*` settings are
  configured; the production compose block `depends_on` it.

## Configuration

Environment-driven, layered from three files under `backend/env/`: `common.env` (`POSTGRES_*`,
`REDIS_URL`, `RABBITMQ_URL`, `WORKER_METRICS_PORT`, `RPC_PREFETCH_COUNT`), `auth.env`
(`JWT_SECRET_KEY`, `JWT_ALGORITHM`, access/refresh lifetimes, `SERVICE_CLIENTS` /
`SERVICE_SCOPES`, the OAuth client credentials and `OAUTH_REDIRECT`), and
`identity.env` — see [`../env/identity.env.example`](../env/identity.env.example), which carries
only the service-specific overrides:

- `WORKER_METRICS_PORT` — unset disables the metrics server entirely.
- `REFRESH_ROTATION_GRACE_SECONDS` (default 60) — how long the immediately-previous refresh
  token of a live session may be replayed once more instead of counting as a reuse attack; `0`
  restores hard single-use.

Settings that change behaviour elsewhere: `DISCORD_/TWITCH_/BATTLENET_OAUTH_ENABLED` gate which
providers are advertised, `SERVICE_CLIENTS` defines which machine callers may mint service
tokens, and `RPC_PREFETCH_COUNT` bounds in-flight requests per process.

## Running

```bash
# From backend/, with the workspace virtualenv active
cd backend/identity-service
faststream run serve:app
```

In Docker the service runs headless as the `identity-svc` compose service, in the default
profile (no `--profile` flag needed). Because it has no HTTP server, the image's HTTP
healthcheck does not apply: dev disables the healthcheck outright, production replaces it with
a `python -c "import sys; sys.exit(0)"` liveness probe. The dev command adds `--reload` over the
mounted `identity-service/` and `shared/` sources.

## Operational notes

- **RBAC cache.** Resolved permissions, denies and workspace memberships are cached in Redis
  under a versioned key (`rbac:v3:user:<id>`) with a 60-second TTL, and invalidated explicitly
  on every RBAC mutation, account deletion, and via `invalidate_session` from another service.
  The version prefix is what retires entries whose payload shape changed. The cache is
  best-effort: a Redis outage costs extra database work, never a failed request.
- **Refresh-token rotation.** Rotation is single-use with reuse detection — replaying a
  revoked token revokes the whole session family. Two escape hatches keep honest clients out of
  that path: a 30-second Redis idempotency entry so concurrent refreshes of the same token
  share one result, and `REFRESH_ROTATION_GRACE_SECONDS` (60s) for a rotation whose response
  never reached the client, after which the successor minted by the lost rotation is retired.
- **Cross-domain tickets.** SSO tickets live 60s, pending-link tickets 120s, both in Redis,
  both single-use via `GETDEL`, and both bound to a hashed host-only guard cookie so a ticket
  can only be redeemed by the browser that started the flow.
- **Session revocation** blacklists the session id for the remaining access-token lifetime, so
  an already-issued access token stops working before its own expiry.
- **Hot path.** Every authenticated request in the platform ends up here; production reserves
  0.5 CPU and caps at 1.0 for this reason. Under-provisioning it throttles all traffic.
- **Backpressure.** `RPC_PREFETCH_COUNT` (default 16) caps concurrent processing per process so
  the backlog stays in the queue, where the gateway's deadline can expire it, rather than in
  the consumer buffer.
