# App Service (`app-svc`)

App-service owns the read side of the platform plus the administration of everything that is not a
tournament: the game catalog, player identities, workspaces (the tenant), platform audit, and binary
assets. It exists as its own process because this is the hottest path in the system — nearly every
anonymous page view resolves to one of its reads — and because its cache lifecycle is its own:
a single event consumer drives invalidation for the whole read surface.

It is a headless FastStream worker. It opens no HTTP port and serves no routes. The Go gateway is the
only process speaking HTTP; it maps REST routes under `/api/v1/*` onto request/reply RPC on
`rpc.app.*` with an `x-deadline-ms` budget, and this worker answers with an `{ok, data, error}`
envelope (`src/rpc/_common.py` → `shared.rpc.common`).

- **Compose service:** `app-svc`
- **Entry point:** `serve.py`
- **Run command:** `faststream run serve:app`
- **Transport:** RabbitMQ request/reply (`rpc.app.<method>`); no HTTP
- **Metrics:** Prometheus on `WORKER_METRICS_PORT` (dev 9109, prod 9109)

See [`../../docs/architecture.md`](../../docs/architecture.md) for the system overview and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the `rpc → services → domain → repository → models`
layering every backend service follows.

## Responsibilities

- **Game catalog** — native per-discipline character/map/mode reads over `catalog.entity`, discipline
  descriptors and metadata, generic discipline-and-kind admin CRUD, and the alias-miss worklist that
  closes the loop when the parser meets a name it cannot resolve.
- **Player identity** — the domain player, social accounts and their visibility, favourites, and the
  destructive profile merge that collapses two players into one.
- **Read aggregations** — one game's per-user tournament/encounter/map/character/teammate histories,
  cross-user comparison, leaderboards, the platform dashboard and tournament readiness.
- **Tenancy** — workspaces, membership and roles, custom domains, and Discord guild claim.
- **Achievement reads** — a user's earned/locked achievements and the per-achievement earner list,
  including the workspace-scoped rarity aggregate.
- **Binary assets** — workspace icons, platform assets and match-log download, exchanged as base64
  inside the RPC envelope and stored in S3.
- **Read-cache lifecycle** — the Redis read cache (cashews) that fronts all of the above, and the
  invalidation consumer that drops it when tournament data changes.

## Interface

The worker subscribes to literal subjects in the `rpc.app.*` namespace under `src/rpc/`,
including one catalog-admin handler per verb rather than per discipline or kind. The full method
list with request/response schemas is published at `/api/docs`, generated from
`src/openapi_schemas.py` (`OPERATIONS`) and `src/openapi_docs.py` (`DOCS`).

### Method groups

| Group | Subject shape | What it covers | Module |
| --- | --- | --- | --- |
| Catalog reads | `rpc.app.read.{get,list}`, `rpc.app.catalog.{list,get}`, `rpc.app.disciplines.{list,metadata}` | Native `/api/v1/catalog/{discipline}/{kind}[/{id}]` reads over `catalog.entity`, installed disciplines and their metadata, achievement get+list | `reads_generic`, `catalog`, `disciplines` |
| Statistics | `rpc.app.statistics.*` | Platform dashboard, tournament readiness, one game's character playtime and character leaderboard (`/api/v1/statistics/{discipline}/characters/playtime`, `/api/v1/statistics/{discipline}/characters/{entity_id}/leaderboard`), and the champion/winrate/won-maps player boards; every game-shaped read names its `discipline` (422 absent, 404 `discipline_not_installed`), except the three player boards, where it is optional (absent or `all`: one cross-game board) | `statistics` |
| Users | `rpc.app.users.*` (reads) | Profile and search; per-user tournament, encounter, map, character (`/users/{id}/characters`), teammate and match histories; cross-user and cross-character comparison (`/users/{id}/compare`, `/users/{id}/compare/characters`); the users-overview grid. Every statistics read takes a required `discipline`, except the tournaments and encounters tabs, where it is optional (absent or `all`: every game, each row naming its own `discipline`; `mvp1` then is a 422); the per-tournament reads use their tournament's own game | `users` |
| Achievements | `rpc.app.achievements.*` | A user's earned/locked achievements and the earner list for one achievement | `achievements` |
| Workspaces | `rpc.app.workspaces.*`, `rpc.app.admin.{update,delete}` | Workspace read plus self-service create (any active user, capped at one owned workspace, reserved slugs rejected), member roster and roles, custom domain lifecycle, Discord guild claim, and the superuser-only `verification_set` trust tier; update/delete via the shared engine | `workspaces`, `admin_crud` |
| Binary assets | `rpc.app.{workspaces.icon_*,assets.*,matches.log}` | Workspace icon and platform-asset upload/delete to S3, match-log download; base64 in the envelope | `binary` |
| User & identity admin | `rpc.app.users.{admin_*,merge_*,social_*,avatar_*,me_*}` | Player CRUD, destructive profile merge, social-account management and visibility, avatar, and the `account.social` self-service subset | `users_admin` |
| Catalog admin | `rpc.app.catalog.admin_*` | Superuser CRUD on `/api/v1/admin/catalog/{discipline}/{kind}[/{id}]`; one handler per verb, discipline and kind from the path | `metadata_admin` |
| Catalog aliases | `rpc.app.catalog_aliases.*` | `catalog.alias_miss` worklist scoped by discipline and kind (`character\|map\|mode` entity names; `stat\|event\|role` codes are dismiss-only): list, attach `{entity_id, alias}`, dismiss | `catalog_aliases` |
| Legacy catalog ids | `rpc.app.catalog.legacy` | Public `/api/v1/catalog/legacy/{hero\|map\|gamemode}/{id}` → `{entity_id, discipline, kind, slug}` for old-link redirects until `discipline02` | `catalog_legacy` |
| Audit | `rpc.app.audit_list` | Read-only platform audit feed and per-entity trail, gated on `audit.read` | `audit` |

### The shared CRUD read engine, and why some subjects carry `#<entity>`

Achievement `get`/`list` is not a handler pair of its own. It is one pair —
`rpc.app.read.get` / `rpc.app.read.list` — dispatched by an `entity` field the gateway puts in the
request body, against the `EntityConfig` table in `src/services/read_registry.py`
(`CrudDispatcher`). Workspace `update`/`delete` work the same way through
`src/services/workspace/registry.py` on `rpc.app.admin.{update,delete}`. Everything else is a
bespoke subject with its own handler.

Because one subject serves many entities, a subject alone cannot key the OpenAPI tables: they use
`"<subject>#<entity>"` instead — `rpc.app.read.get#achievement`, `rpc.app.admin.update#workspace`. The
convention is defined in `shared/rpc/openapi.py` and must match the gateway's lookup. A `#` in an
`OPERATIONS`/`DOCS` key therefore means "generic engine, this entity"; a bare subject means a
bespoke handler.

The public catalog is native: `GET /api/v1/catalog/{discipline}/{kind}[/{id}]` (kinds `character`,
`map`, `mode`) returns `CatalogEntityRead` rows of that one discipline, active rows by default; a kind
the game does not declare is `404 catalog_kind_not_declared`. The old `/api/v1/{heroes,maps,gamemodes}`
list/detail/lookup routes and the `/api/v1/heroes/…` statistics routes are gone; character statistics
live under `/api/v1/statistics/{discipline}/characters/…` and `/api/v1/users/{id}/characters`. All ids
are `catalog.entity` ids; the per-user maps read filters by `mode_id` and expands `parent` /
`character_stats`.

Statistics readers use native `stats.fact`/`stats.stat_def` queries bound to the request's explicit
discipline (`UserService.of(code)`) and workspace-member ownership. Historical observations survive
membership removal.
Profile and achievement match expansions bulk-load bound games and their historical participant
slots: home/away means slots 1/2, never ingestion source order or today's active seats.
`map_index` is the game's position; no pick-ban ordering inference remains. Public match `source`
and `code` are removed (encounter-game replay codes are independent).

Existing hidden-tournament policies, strict >60-second character qualification, 600-second
leaderboard threshold, rank ties and null handling are preserved. Profile/comparison per-10
denominators remain match duration; character leaderboards use character playtime. MVP placement
prefers ImpactRank over Performance. See [player statistics semantics](../../docs/users-identity.md#93-public-player-app-service).

Native floating-point statistics reductions have a fixed observation order: match and historical
workspace member, then character/stat identity when a group spans them. Rolled-up character totals
use character identity order. Stored facts and the existing presentation rounding are unchanged.
This replaces the legacy executor's unspecified SUM order; a last-bit difference can move a
displayed total by 0.01 at a rounding boundary. The P4 app parity policy proves these changes from
the frozen operand bits, historical member/encounter-participant identities and exact denominators,
checks the native left-fold result bit-for-bit, and links displayed values to `round(raw, 2)`.
The regular-comparison exceptions also prove the filtered population inputs and cohort-average
arithmetic. This does not relax ranks, thresholds, best values or ownership, metadata, or unrelated
fields. The separate initial global-MV average allowance remains at most 1e-12, with exact native
derivation.

Catalog admin uses `CatalogEntityCreate`, `CatalogEntityUpdate` and `CatalogEntityRead` rather
than those Overwatch-shaped models. PATCH shallow-merges `attrs` (present keys replace, absent
keys keep); a name-only edit keeps the stored slug. Explicit null for `name`, `slug`, `attrs` or
`active` is rejected with 422, and the effective slug must fit 64 characters without truncation.
Parent and character-class validation comes from the discipline module. The existing Overwatch
admin pages adapt to this generic wire; discipline-driven public and admin pages are a later phase.

The legacy-id lookup accepts `hero`, `map` or `gamemode` plus an ASCII decimal id in `1..2**63-1`;
unknown kinds, invalid ids and missing mappings return 404. The frontend proxy redirects old
hero/map query filters on `/users/heroes-compare`, `/users/compare` and
`/tournaments/{id}/matches` with a 308, preserving the other query parameters. The route,
mapping table and redirect are temporary.

### Role ontology and workspace formats

At startup the app projects module-declared dimensions and roles into `catalog.role_dimension` /
`catalog.role`; exactly one dimension per discipline is rated. Removed module roles are deactivated,
not deleted. `CatalogRoleRepository` resolves module roles and the owner's workspace sub-roles;
their codes are `<parent>_<slug>` (for example `support_main`), with immutable parents.

Workspace reads expose `disciplines_enabled` (priority order, `[0]` is the default game), writable by
anyone with `workspace.update` on that workspace; disabling a game only refuses new tournaments and mixes in it. Workspace default
formats are read/written through
`GET|PUT /api/v1/workspaces/{workspace_id}/team-formats/{discipline}` using
`TeamFormatRead` / `TeamFormatWrite`; `default_roster_slots_json` is no longer on the wire.
Tournaments own editable copies; mixes freeze copies at creation, so editing a template does not
rewrite existing events.

User/player role fields use leaf `RoleRef {dimension, role, parent}` values; inputs ignore `parent`.
GET role filters carry JSON refs. On overview, overview stats and catalog reads, omission means
no filter, while explicit `role=null` selects no rated-role assignment (the UI's Flex chip).
Compare controls do not offer Flex. `flex` is an open-slot key, not an ontology role.
See the [P2 release guide](../../docs/multi-game-p2-roles-release.md) for all wire breaks.

### Consumed queue

`tournament_changed_app_service`, bound to the `tournament.changed` topic exchange on
`tournament.changed.*` (`shared/messaging/config.py`). Tournament-service publishes onto that
exchange through the transactional outbox whenever public tournament data changes, and
stats-service does the same when a match log lands; app-service and tournament-service each hold
their own durable queue on it, so both see every event.

On each event (`src/services/tournament_events.py`) this worker:

1. skips `reason == "bracket_changed"` — nothing it caches depends on bracket shape, which makes
   stats-service's match-log event a no-op here;
2. `delete_match`es the affected Redis read-cache patterns: `*tournaments/{id}*`, every user-scoped
   flow key (the event does not name the users a tournament touched), the users-overview id order,
   and the per-workspace achievement-rarity aggregate;
3. requests a debounced refresh of the `stats.mv_entity_global_stats` materialized view.

This invalidates **this service's** Redis cache only. The gateway's own anonymous response cache is
invalidated separately, off the `realtime:tournament:{id}:{bracket,draft}` Redis channels that
tournament-service publishes from its consumer of the same exchange; the gateway subscribes to those
for WebSocket fan-out and reuses the signal (`gateway/internal/respcache`). Nothing app-service does
reaches the gateway cache directly.

### Published events

`WorkspaceMemberChangedEvent`, through the transactional outbox straight onto the
`workspace_member_changed` queue (default exchange): staged by every `WorkspaceService` operation
that changes who holds a workspace role (create, member add/update/remove, owner transfer) and by
the profile merge, in the write's own transaction. identity-service consumes it and drops the cached
RBAC payload of the listed users. App-service publishes no Redis realtime topics.

### Scheduled work

An `event_outbox_drain` tick every second (`shared.messaging.outbox.drain_outbox`), relaying the
outbox rows this service writes. And one debounced background job: the
`stats.mv_entity_global_stats` refresh
(`src/services/hero_stats_refresh.py`). Fired best-effort at startup and on every
`tournament_changed` event, throttled to one run per hour by a Redis-held cooldown key, guarded by a
Postgres advisory lock, and executed with `statement_timeout` disabled and `work_mem` raised. It runs
as a background task and never blocks the event consumer.
`stats01` populates the view during migration. Runtime refreshes use `CONCURRENTLY`;
an explicitly unpopulated rebuild uses a first plain refresh. Unpopulated reads and
refresh failures are errors, not empty statistics. The refresher role must own this MV
and have SELECT on its native sources; ordinary readers need only SELECT on the MV.

### Outbound RPC

`rpc.identity.oauth_discord_guilds` (identity-service), to confirm the caller administers the Discord
guild they are claiming for a workspace. `discord_guild_channels` (discord-service, via the RPC-only
`shared.services.discord_client.DiscordClient`), to check a workspace's notification channel belongs
to its own guild.

## Data owned

There are no per-service migrations. All models live in one SQLAlchemy metadata under
[`../shared/`](../shared/README.md) and all migrations in one Alembic project at
[`../migrations/`](../migrations). Per-domain entity diagrams are in
[`../../docs/database_erd.md`](../../docs/database_erd.md).

**Writes:**

- `players` — `user`, `social_account`, `social_account_visibility`, `favorite_player`,
  `user_merge_audit` ([identity](../../docs/database_erd.md#identity--auth-players)).
- `public` — `workspace`, `workspace_member`, `audit_log`
  ([tenancy](../../docs/database_erd.md#tenancy--public),
  [platform](../../docs/database_erd.md#platform--public-realtime)).
- `catalog` — `entity`, `alias_miss`, plus the startup `role_dimension` / module `role` projection
  ([catalog](../../docs/database_erd.md#catalog--catalog)).
- `roster` — workspace defaults in `team_format`, `team_format_dimension`, `format_role_rule`
  ([roster](../../docs/database_erd.md#roster--roster)).
- `achievements` — `override` and `evaluation_result`, only to repoint `workspace_member_id` during a
  merge ([achievements](../../docs/database_erd.md#achievements--achievements)).

Profile merge also repoints `tournament.team.captain_id` and `stats.ingest_job.uploader_user_id`.
Member-anchored tournament, registration and achievement references follow their resolved member.
Native `stats.match_player`, `stats.fact` and both actor/target identities in `stats.event` move via
`StatsMatchRepository.merge_member_history`, within one workspace. Any same-match overlap is a
409 `stats_member_history_conflict`, never a sum or deduplication. With no target membership, the
source membership id is retained and its player identity changes; no member is fabricated.
The original `UserMergeAudit` preview JSON retains complete global/member mappings and stable
native statistics audit ids.

User/workspace deletion captures native evidence, flushes the deletion and stages its audit in
the same transaction. Played-member deletion remains refused. Match-log downloads resolve
`StatsMatch` → `IngestJob.raw_ref` and game → encounter tournament, authorize visibility before
fetching that actual S3 key, and use the filename only for display.

**Other reads:** `tournament`, native `stats`, `balancer`, `registration`, `mix`, `draft`, `auth` (for the acting identity and its
roles), and `catalog.entity_legacy` for old-id lookups. No runtime access to legacy `matches`,
`log_processing` or `overwatch` tables remains.

## Dependencies

- **PostgreSQL** — the shared database; every read aggregation and every write above.
- **Redis** — two logical databases via cashews: `/3` behind the `fastapi:` key prefix and `/4`
  behind `backend:`. Holds the read cache, the stampede lock namespace, and the MV refresh cooldown.
  Both prefixes must be registered before any subscriber runs; cashews has no default backend and
  raises `NotConfiguredError` for an unroutable key (`src/core/caching.py`).
- **RabbitMQ** — RPC transport and the `tournament_changed` consumer.
- **S3 / MinIO** — workspace icons, platform assets, match-log objects.
- **identity-service** — over RPC, for Discord guild verification.
- **discord-service** — over RPC, for the notification-channel check.

No outbound calls to third-party APIs, so no `proxy` egress. (The compose block still declares
`depends_on: proxy` — startup ordering only.)

## Configuration

`backend/env/common.env` then `backend/env/app.env`, in that order. Settings are typed in
`src/core/config.py` on top of `shared.core.config.BaseServiceSettings`.

Behaviour-changing settings:

- `RABBITMQ_URL` — required, no default. `RPC_PREFETCH_COUNT` caps unacked RPC messages per channel.
- `REDIS_URL` — the base URL; the service derives `/3` and `/4` from it.
- `POSTGRES_*` and the `DB_POOL_*` knobs. Set `DB_PGBOUNCER=true` **before** scaling replicas — each
  process opens up to `DB_POOL_SIZE + DB_MAX_OVERFLOW` server connections.
- `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_ENDPOINT_URL` / `S3_BUCKET_NAME` / `S3_PUBLIC_URL`.
- Cache TTLs: `users_cache_ttl` and `achievements_cache_ttl` (300s), and `user_profile_cache_ttl`
  (60s). The profile TTL is short on purpose — identity-service avatar/name edits have no
  cross-service invalidation hook, so that TTL is the only bound on their staleness.
- `WORKER_METRICS_PORT`, `TRACING_ENABLED`, `OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER*`, `SENTRY_*`,
  `LOG_LEVEL`, `JSON_LOGGING`.

## Running

Locally, from `backend/app-service/` with the shared env loaded:

```bash
faststream run serve:app
```

In compose (`app-svc` in both files, default profile — always started):

- Dev mounts `backend/app-service` and `backend/shared` and runs with `--reload --reload-dir` for
  both, with `WATCHFILES_FORCE_POLLING=true`. No healthcheck.
- Production runs the bare command, sets a CPU ceiling of 2.00 and `restart: always`, and declares a
  healthcheck of `python -c "import sys; sys.exit(0)"`.
- Both wait on `redis`, `rabbitmq` and `proxy` being healthy.

Layering check — the `services/` sub-domain hierarchy (`achievements` → `dashboard | user` →
`hero | map | statistics | workspace`) is enforced by `.importlinter`. From `backend/`:

```bash
uv run lint-imports --config app-service/.importlinter
```

The contracts and the grandfathered violations are explained in
[`../docs/architecture/layering.md`](../docs/architecture/layering.md).

## Operational notes

- **DLQ.** The invalidation queue is durable, carries `x-message-ttl` 300000, and dead-letters to
  `tournament_changed_app_service.dlq` through the `dlx` exchange. A rejected message and a message
  left unconsumed for five minutes both end up there, and nothing re-drives that queue: an
  invalidation lost this way is only repaired by the next event or by the read cache's own TTL.
- **Channel isolation.** The consumer runs on its own AMQP channel with `prefetch_count=4`, so a
  burst of invalidations cannot starve RPC replies of QoS credit.
- **Startup cache purge.** `serve.py` drops `fastapi:*` and `backend:*` on boot, so a redeploy never
  serves entries produced by the previous image's serializers.
- **Replicas.** Multiple replicas round-robin the single invalidation queue, which is correct — the
  cache they invalidate is shared. The MV-refresh cooldown lives in Redis rather than in process
  memory for the same reason, and the refresh itself is serialised by a Postgres advisory lock.
- **The production healthcheck proves only that Python starts.** It does not test the broker
  connection, the database, or subscriber registration; a worker with a dead broker still reports
  healthy.
- **Cache invalidation is broad on purpose.** A `tournament_changed` event carries no workspace and
  no user list, so user-scoped and rarity keys are dropped wholesale. Expect a cold-cache burst of
  heavy aggregation queries immediately after tournament ingestion.
