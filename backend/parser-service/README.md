# Parser Service (parser-svc)

Parser owns everything that turns raw Overwatch artefacts into domain data: match-log files
uploaded from the tournament admin or dropped into a Discord channel, Overwatch rank telemetry
polled from OverFast, the declarative achievement engine evaluated on top of parsed results, and
the MVP impact scoring derived from match statistics. It also syncs discipline catalogs through
their modules (OverFast for Overwatch, Data Dragon for LoL). It is a separate process because that work
is minutes-long, IO-bound and bursty — one log parse holds a database session and one unacked
delivery for as long as the file takes — and must never share a channel or a request path with
interactive reads.

It is a headless FastStream worker on RabbitMQ: no HTTP server, no listening port, no uvicorn.
Requests reach it as request/reply RPC on `rpc.parser.<method>`, published by the Go gateway (the
only process speaking HTTP to the outside) under `/api/v1` with an `x-deadline-ms` budget; the
worker replies with an `{ok, data, error}` envelope. Everything else arrives as a durable queue
job or a domain event.

- **Compose service:** `parser-svc`
- **Entry point:** `serve.py`
- **Run command:** `faststream run serve:app`
- **Transport:** RabbitMQ request/reply (`rpc.parser.*`); no HTTP
- **Metrics:** Prometheus on `WORKER_METRICS_PORT` (dev 9100, prod 9100)

System overview: [`../../docs/architecture.md`](../../docs/architecture.md). Code layering:
[`../ARCHITECTURE.md`](../ARCHITECTURE.md). Shared kernel: [`../shared/README.md`](../shared/README.md).

## Responsibilities

- **Match-log ingestion** — owns the `stats.ingest_job` lifecycle and native observations in
  `stats.match`, `stats.match_team`, `stats.match_player`, `stats.segment`, `stats.fact` and
  `stats.event`. One match belongs to one existing live encounter game.
- **Catalog name resolution** — Overwatch map/gamemode/hero names resolve through canonical names
  or `catalog.entity.aliases`, scoped to the discipline and kind, never through code. Unknown names
  fail the attempt rather than silently dropping observations. After rollback, their
  `catalog.alias_miss` breadcrumbs are committed separately with the actual `stats.ingest_job` id;
  adding the missing alias and explicitly retrying preserves the original raw bytes.
- **Player resolution from logs** — resolves real workspace members and historical game
  participations, including substitutes and event-only players. Roster snapshot repairs and
  battlenet renames share the observation transaction; ingestion does not grant workspace access.
- **Overwatch rank collection** — selects due battle tags, fetches career summaries from OverFast
  and keeps the per-tag collection state, snapshot series and fetch log.
- **Achievement evaluation** — owns the condition-tree engine, the rules admin surface, the
  evaluation runs and the manual grant/revoke overlay.
- **MVP impact scoring** — derived stats (`PerformancePoints`, `Performance`, `ImpactPoints`,
  `ImpactRank`, `OverperformanceScore`), the versioned baselines they are scored against, and the
  idempotent historical backfill.
- **Subscription entitlement collection** — periodic and on-demand re-checks of Discord/Twitch
  subscription entitlements used as a registration admission condition.
- **Global settings and the per-tournament Discord channel binding.**

## Interface

RPC namespace: `rpc.parser.*` (single namespace, registered in `src/rpc/`).

| Method group | Surface |
| --- | --- |
| `rpc.parser.logs.*` | Match-log admin: queue depths, processing history and stats, upload, retry, whole-tournament reprocess |
| `rpc.parser.rank.*` | Public rank reads (user/battle-tag history, current ranks) plus collection admin: health stats, fetch log, trigger collection, re-enable auto-disabled tags |
| `rpc.parser.ach.*` | Achievement rules CRUD, condition-type catalog and tree validation, seed/reset, export/import and cross-workspace library import, evaluation trigger and runs, rule test/dry-run, qualifying-user list, manual overrides |
| `rpc.parser.subscription.*` | Subscription collection admin: health stats, check log, per-user entitlement, trigger a re-check or a sweep |
| `rpc.parser.impact.*` | Superuser recompute of the impact-scoring baselines |
| `rpc.parser.catalog.sync` | Superuser `POST /api/v1/admin/catalog-sync/{discipline}`; dispatches through `shared.disciplines` to that module's source (OverFast or Data Dragon) |
| `rpc.parser.settings.*` | Superuser global settings CRUD (`public.settings`) |
| `rpc.parser.discord_channel.*` | Per-tournament Discord channel binding, plus an on-demand channel-history backfill |

The full method list with request/response schemas is published at `/api/docs`, generated from
`src/openapi_schemas.py` (`OPERATIONS`) and `src/openapi_docs.py` (`DOCS`).

### Queues consumed

| Queue | Event | Effect |
| --- | --- | --- |
| `upload_match_log` | `UploadMatchLogEvent` | Persist the original decoded bytes to a content-addressed S3 key, create/find the native ingest job, enqueue its id |
| `process_match_log` | `ProcessMatchLogEvent` | Process one authorized `ingest_job_id`; own channel, prefetch 2 |
| `process_tournament_logs` | `ProcessTournamentLogsEvent` | Requeue the tournament's actual native jobs and fan out one job-id event each, including imported raw references |
| `achievement_evaluate` | `AchievementEvaluateEvent` | Run the achievement engine for a workspace |
| `achievement_evaluate.deferred` | `AchievementEvaluateEvent` | Resumes a `queued` run an unverified workspace's manual/`rule_version_bump` recompute was parked as; own channel, prefetch 1 |
| `tournament_encounter_completed` | `EncounterCompletedEvent` | Bound to the `tournament.events` exchange; fills in the encounter's Push/Clash map scores (`match_logs/objectiveless.py`), then enqueues an achievement evaluation |
| `tournament_registration_approved` | — | Bound to the same exchange; prioritises and enqueues a rank check for the approved player |
| `tournament_registration_rank_check` | `RegistrationRankCheckRequestedEvent` | Same rank check, asked for by the registrant from their own card |
| `rank_fetch`, `rank_fetch_priority` | `FetchRankEvent` | One OverFast call per battle tag; shared channel with prefetch `RANK_FETCH_WORKER_PREFETCH` |

Every one of those queues carries `x-dead-letter-exchange=dlx` and an `x-message-ttl`; the worker
declares and binds its own DLQs at startup, so an expired or rejected job is visible in
`<queue>.dlq` instead of being dropped by an unbound routing key.

`process_match_log` gets a channel of its own because it is the one minutes-long handler here: a
delivery that outlives RabbitMQ's `consumer_timeout` closes its whole channel, and that must not
take `upload_match_log`, `process_tournament_logs` and `achievement_evaluate` down with it.

### Ingestion path

1. **Arrival.** The gateway relays a multipart upload as base64 to `rpc.parser.logs.upload`
   (`log.create` on the tournament's workspace), or Discord publishes `UploadMatchLogEvent`.
   Discord resolves the uploader through their linked social account; source is `discord` or
   `upload`. Filenames are display metadata, not job identity.
2. **Store.** `uploads.py` validates size, UTF-8, a finished log, and a filename of at most
   500 characters without path separators, `..` or NUL. It hashes the actual bytes (SHA-256),
   stores those same bytes at `logs/{tournament_id}/{content_hash}`, then records the job.
   A failed PUT never creates a dangling job; a failed DB insert may leave an unreferenced object.
   Imported `raw_ref` values are preserved and remain readable by their job ids.
3. **Deduplicate.** New uploads use `external_id = NULL` and a workspace/content-hash unique key.
   Concurrent uploads of identical bytes return the same job without resetting its status,
   attempts, filename, uploader or hints. Same filename with different bytes creates distinct
   jobs and objects. A same-workspace hash with conflicting discipline/tournament intent returns
   `stats_upload_scope_conflict` (409); invalid owner/game hints return
   `stats_upload_hint_conflict` (422). Different workspaces never deduplicate together.
4. **Enqueue and claim.** `ProcessMatchLogEvent` carries only `ingest_job_id` plus common event
   metadata. Processing uses that row's authorized `raw_ref`, checks the stored hash, and commits
   the `processing` claim/attempt before parsing. Ownership is the exact saved
   `(attempts, started_at)` pair, checked before observations, completion and failure writes;
   an explicit retry may reset the attempt budget but cannot revive an old worker's claim.
   A delivery finding an active claim acknowledges without parsing or publishing a terminal
   result. Duplicate terminal delivery returns the persisted state. Bulk processing enumerates
   native jobs, never guessed S3 filenames.
5. **Bind before replacement.** The parser resolves teams, map and map-pool restrictions, then
   locks the owning encounter and an existing noncancelled game. Workspace, discipline, map and
   the game's exact two historical participants must agree; inactive historical participation
   does not disappear. Zero or multiple matching games persist `awaiting_link`, with no
   observation writes or parse-success achievement event. No newest-game heuristic or invented
   game is used. An administrator can retry with `encounter_id` and `encounter_game_id`; omitted
   hints are retained and a previously linked log cannot be reassigned.
6. **Write atomically.** Native player/fact/event/segment rows use workspace-member and
   encounter-team ids, with observed `source_position` independent of live slots. All scope,
   vocabulary and participant constraints are validated before deleting the old children.
   Reparse keeps the match id, replaces its observations and increments its revision once.
   Score facts do not overwrite accepted live-game scores or `result_version`. Observation
   replacement, score derivation, invalidation/achievement outbox rows, the `done` transition and
   sealed `stats.reparse`/`stats.job_transition` evidence share one commit.
7. **Failure and result.** Decode, validation or write failures first roll back the observation
   transaction, then mark the matching claim `failed` separately, preserving the previous
   successful revision. `awaiting_link` is neither success nor failure. After commit the worker
   broadcasts the actual state in `MatchLogProcessedEvent`, with its job id and error text.
   Only a failure before job creation has a null `ingest_job_id`; result delivery is best-effort.

**Correlation.** Discord sets `correlation_id` to the upload event's `event_id`, registers its
future **before** publishing, and carries the same value through processing and result events
(including broker correlation metadata). It then consumes the complete result, even if that
result arrived during publish. `match_log.result` is a fanout so each replica can resolve its own
registered correlation; filename/tournament are display fields only. Publish failure, timeout
and cancellation remove the future. A pending or failed job is never inferred from a
latest-by-filename database query.

**Follow-up and recovery.** Successful observation writes enqueue `AchievementEvaluateEvent`
with `stats.match`, `stats.fact` and `stats.event`; lifecycle commits use `stats.ingest_job`.
These durable outbox rows and their creation evidence share the writing transaction. The reaper
claims stalled `pending`/`processing` jobs with `FOR UPDATE SKIP LOCKED`; only entering processing
costs an attempt. Exhausted claims become `failed`. Neither `failed` nor `awaiting_link` is
automatically retried. Explicit admin retry resets the budget after ownership/hint validation.

**Maintenance cutover.** Drain old `process_match_log` messages before deploying the job-id
schema; tournament/filename processing payloads have no compatibility adapter.

### Achievement engine

Rules are data, not code. An `achievements.rule` row carries a JSON condition tree of `AND` / `OR` /
`NOT` nodes over leaf conditions; each leaf is `{"type": ..., "params": {...}}` dispatched through a
decorator-populated registry in `src/services/achievement/engine/conditions/`, so adding a condition
type means adding one registered executor, and authoring an achievement means editing JSON through
the admin API. Evaluation returns sets of tuples whose shape follows the rule's grain — `(user_id)`,
`(user_id, tournament_id)` or `(user_id, tournament_id, match_id)`.

A run is a reconcile, not an append: the differ loads the stored results for the rule (optionally
sliced to one tournament or match), computes insert/delete sets against the fresh evaluation, and
applies them with `INSERT ... ON CONFLICT DO NOTHING`, so two concurrent runs for the same workspace
converge instead of colliding on the dedup index. Re-running an unchanged rule is therefore a no-op.
Incremental runs narrow the rule set by `depends_on` against the event's `changed_tables`.

Manual admin decisions live in a **separate overlay**, `achievements.override` (grant or revoke,
with reason and granting actor). The engine never reads or writes that table, so no re-evaluation
can erase an admin decision; the two are merged only at read time, by
`shared.services.achievement_effective` — grants union into the effective set, revokes filter out of
it.

### Rank synchronisation

Collection is bound to a linked `social_account` (a battlenet account owned by a player), never to a
bare BattleTag string: `overwatch_rank.battle_tag_state` is keyed on `social_account_id`, and the
snapshots it produces are attributed to that account's user. An unlinked tag is not collected.

Per-tag state carries `next_eligible_at`, `consecutive_failures` and `status`. On success the tag is
rescheduled at the admin-configured `interval_seconds` with jitter and the failure counter resets.
A **private** profile is not a failure: the status becomes `private`, failures reset, and the tag is
rescheduled at 4× the base interval — the account still exists and may be opened later. `not_found`
gets 8×. A permanent failure backs off exponentially (`backoff_base_seconds * 2^n`, clamped to six
hours) and, once `max_consecutive_failures` is reached, disables the tag. Transient upstream failures
(OverFast 5xx/timeouts, 429) back off the same way but never disable, because an outage would
otherwise permanently disable healthy accounts with no recovery path;
`rpc.parser.rank.reenable_disabled` is the operator escape hatch for tags disabled in the past.
Redis carries the rest of the protection: per-account enqueue and in-flight dedup keys, a fixed
per-minute window (over it a tag is deferred past the window rather than fetched — the only rate
control the priority queue has, since registration approvals bypass the scheduler's pacing) and a
global cooldown key set on a 429.

### Events published

- `match_log.result` (fanout) — `MatchLogProcessedEvent`, consumed by discord-service.
- `process_match_log` — fanned out by the tournament-wide job and by the stall reaper.
- `achievement_evaluate` — transactionally enqueued for native observations, job lifecycle changes and `EncounterCompletedEvent`.
- `achievement_evaluate.deferred` — a manual or `rule_version_bump` run for a workspace whose
  `verification_status` is `unverified`: the run row is created `queued` and the message carries its
  id, so the consumer finishes that row instead of opening a second one. `parse_complete` is never
  deferred.
- `rank_fetch` / `rank_fetch_priority` — from the collection tick, the admin collect RPC and
  registration approval.
- `discord_commands` — `DiscordCommandEvent` for the on-demand channel-history backfill.
- Through the transactional outbox (`public.event_outbox`): achievement evaluation and tournament
  score/cache invalidations; `EncounterCompletedEvent` is emitted when the encounter is already
  completed, without accepting a live-game result on the log's authority.

### Realtime

`logs.updated` on the workspace-scoped topic `workspace:{id}:logs`, published straight to Redis for
the gateway to relay to the admin log monitor. Non-durable and payload-free: no journal row, no
replay cursor — the monitor refetches `/admin/logs/history` on the signal and does an initial fetch
on subscribe, so a missed signal self-heals, and the actual log data stays gated by `log.read`.

### Scheduled work

All four are APScheduler interval jobs guarded by a Redis leader lock, so only one replica acts per
tick.

| Job | Cadence | What it does |
| --- | --- | --- |
| OverFast rank collection | 60s tick | Selects and *claims* due battle tags and publishes one `FetchRankEvent` each — it never calls OverFast itself. Per-tag cadence comes from `next_eligible_at`, so changing the admin interval needs no restart. No-ops while collection is disabled in settings. |
| Match-log stall reaper | `LOG_REAPER_TICK_SECONDS` (300s) | Requeues native jobs dropped by the queue: `pending` older than `LOG_REAPER_PENDING_AFTER_SECONDS` and `processing` older than `LOG_REAPER_PROCESSING_AFTER_SECONDS`. Exhausted attempts become `failed`; awaiting-link is never claimed. Keep the pending threshold above the queue TTL. |
| Failed match-log retention | 1h tick | Deletes only expired failed jobs whose raw reference is unused by another job or match. A linked match keeps both its job row and raw object, not an orphaned object with no usable reference. Storage deletion failure keeps the row; an upload's raw-key lock prevents concurrent deletion. Alias breadcrumb SET NULL and deleted-owner evidence share the deletion transaction. Invalid/uncompleted uploads are rejected before persistence; processing never deletes raw bytes as validation cleanup. |
| Subscription collection | 60s heartbeat | Decides inside the tick whether the admin-configured `interval_seconds` has elapsed (read from the append-only check log), then re-checks entitlements for active tournament participants. |

## Data owned

Writes:

- `stats` — `ingest_job`, `match`, `match_team`, `match_player`, `segment`, `fact`, `event`,
  `stat_baseline` and `discord_channel` (the Discord channel binding).
- `overwatch_rank` — `battle_tag_state`, `rank_snapshot`, `fetch_log`.
- `achievements` — `rule`, `evaluation_result`, `evaluation_run`, `override`.
- `catalog` — `alias_miss` for unresolved Overwatch log names, plus `entity` aliases and rows
  written by each discipline module's sync; app-service owns the public reads and generic admin CRUD.
  No runtime access to the legacy `overwatch` schema remains.
- `subscriptions` — `entitlement`, `check_log` (shared with tournament-service, which owns
  requirements).
- `public.settings` — global key-namespaced settings.
- As a side effect of ingestion: `players.social_account` for battlenet renames and
  `encounter.team_member` snapshots for real workspace members observed as substitutes.
- `public.audit_log` and `public.event_outbox` for transactional evidence and follow-up delivery.

Reads: native `encounter.*` encounters, participations and games; `tournament.*` bracket/team/player
data; `public.workspace`, `public.workspace_member`, the division grid and actor identities.
No runtime reads or writes of the retired `matches` or `log_processing` schemas are needed.

No service ships its own migrations — there is one Alembic project at
[`../migrations/`](../migrations/). Entity diagrams for these tables:
[`../../docs/database_erd.md`](../../docs/database_erd.md), sections *stats*, *tournament*,
*ranks*, *achievements*, *catalog* and *subscriptions*.

## Dependencies

- **PostgreSQL** — the shared SQLAlchemy metadata from `backend/shared/`; one database for all
  services.
- **RabbitMQ** — RPC transport, durable job queues, the tournament event exchange, the match-log
  result fanout and the DLQs.
- **Redis** — scheduler leader locks, rank-collection dedup/rate-limit/cooldown keys, the cashews
  cache for impact baselines, and the realtime publish channel.
- **S3** — new raw logs at `logs/{tournament_id}/{content_hash}` (imported keys remain unchanged)
  and catalog images at `assets/{discipline}/{kind}/{slug}.{ext}`; an image already stored survives sync.
- **OverFast API** (self-hosted on the production host, called directly) — player career
  summaries for rank collection and the Overwatch module's hero/map/gamemode catalog; the
  hero sync pulls all 13 Blizzard locales and only ever adds aliases. OverFast exposes no
  `locale` parameter for `/maps` or `/gamemodes`, so their aliases are admin-supplied.
- **Data Dragon** — the League of Legends module's champion and map catalog, using the
  latest published version. Both sources mirror images through `shared.catalog_sync`.
- **Discord and Twitch APIs** — subscription entitlement verification.
- Discord and Twitch calls egress through the outbound **`proxy`** container.

Sync adds missing rows and aliases without overwriting an existing row's name or `attrs`, including
admin-edited classes and map flags. New Overwatch maps start with `attrs.in_competitive = true`.
An existing parent is never replaced: a source parent fills `parent_id` only when it is null.
Images already on the bucket survive, and rows absent from a later source response are not deleted
or deactivated.

Adding a catalog row or alias needs no deploy: sync the whole discipline or use
`/api/v1/admin/catalog/{discipline}/{kind}[/{id}]`. The existing Overwatch pages
`/admin/{heroes,maps,gamemodes}` adapt to that API; `/admin/aliases` attaches `{entity_id, alias}`
to a matching discipline and kind and closes the miss in one request.

## Configuration

`backend/env/parser.env`, layered on `backend/env/common.env` (see
[`parser.env.example`](../env/parser.env.example)). Settings that actually change behaviour:

- **Ingestion caps** — `MAX_MATCH_LOG_BYTES` (25 MiB), `MAX_MATCH_LOG_LINES` (500k).
- **Stall reaper** — `LOG_REAPER_ENABLED`, `LOG_REAPER_TICK_SECONDS`,
  `LOG_REAPER_PENDING_AFTER_SECONDS`, `LOG_REAPER_PROCESSING_AFTER_SECONDS`,
  `LOG_REAPER_MAX_ATTEMPTS`, `LOG_REAPER_BATCH_SIZE`.
- **Failed-log retention** — `FAILED_LOG_RETENTION_DAYS` (14).
- **OverFast** — `OVERFAST_BASE_URL`, `OVERFAST_TIMEOUT`, `OVERFAST_MAX_RETRIES`,
  `RANK_FETCH_WORKER_PREFETCH` (kept low to protect the upstream). They belong to the Overwatch
  module's rank collector (`shared/disciplines/overwatch/collector/settings.py`), not to the
  parser's config. The operational collection parameters — interval, scope, per-minute limit,
  backoff base, max consecutive failures, rank mapping — live in `public.settings`, editable at
  runtime, not in the env file.
- **Outbound proxy** — `PROXY_TYPE`, `PROXY_IP`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD`.
- **Subscription verification** — `DISCORD_TOKEN`, `TWITCH_CLIENT_ID`. Unset means every live check
  resolves `unknown` and fails open: the sweep runs and proves nothing.
- **Transport and infrastructure** — `RABBITMQ_URL`, `RPC_PREFETCH_COUNT`, `REDIS_URL`,
  `RABBITMQ_MANAGEMENT_URL` / `_USER` / `_PASSWORD` (queue-depth reads for the admin monitor).
- **Observability** — `WORKER_METRICS_PORT`, `LOG_LEVEL`, `JSON_LOGGING`, `SENTRY_DSN`,
  `TRACING_ENABLED`, `OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER*`.

`PORT` is still present in `parser.env.example` and in `AppConfig`; nothing binds it — it is a
leftover from the decommissioned HTTP service.

## Running

Locally, from `backend/parser-service/`:

```
uv run faststream run serve:app
```

The MVP-impact backfill is a separate CLI (idempotent, safe to rerun):

```
uv run python backfill_impact.py [--tournament-id N]
```

The backfill enumerates Overwatch matches through game → encounter ownership, replaces only the
seven derived non-character fact codes across all segments, and preserves character/raw facts.
Fight metadata is reassigned as complete JSON values. Each match has its own flush/evidence/commit
boundary. Objectiveless resolution adjusts native score facts, not accepted live-game results.

In compose, `parser-svc` is built from `backend/` with `APP_PATH=parser` and depends on healthy
`redis`, `rabbitmq` and `proxy`. Dev runs `faststream run serve:app --reload` with the service and
`shared/` bind-mounted and polling watchers (`WATCHFILES_FORCE_POLLING`); production runs the plain
command with `restart: always`. Production declares a placeholder healthcheck
(`python -c "import sys; sys.exit(0)"`) — it proves the interpreter starts, not that the worker is
consuming; liveness is judged from metrics and queue depth instead.

## Operational notes

- **Shutdown order.** Stop schedulers in `on_shutdown`, but close HTTP, S3 and Redis clients in
  `after_shutdown`. FastStream drains consumers between those hooks; closing clients before
  that drain makes active rank-fetch jobs fail with `Client not started` and sends them to the DLQ.
- **Channel isolation is load-bearing.** RPC, background jobs, match-log parsing and rank fetching
  each get their own channel/prefetch. Collapsing them means one long parse can close the channel
  every other consumer shares.
- **DLQs.** `upload_match_log.dlq`, `process_match_log.dlq`, `process_tournament_logs.dlq`,
  `achievement_evaluate.dlq`, `achievement_evaluate.deferred.dlq`, `rank_fetch.dlq`,
  `rank_fetch_priority.dlq`,
  `tournament_encounter_completed.dlq`, `tournament_registration_approved.dlq`. An achievement
  evaluation that raises is rejected without requeue straight into its DLQ.
- **A stuck "Queued" record is a reaper question, not a queue question.** The row, not the message,
  is the source of truth; check `attempts` and the reaper settings before republishing by hand.
- **Rank fetches are scheduler-retried, not broker-retried.** A transient OverFast failure is
  recorded with backoff and swallowed, so the message is not redelivered; the next tick picks the
  tag up when `next_eligible_at` says so.
- **Baseline cache.** Impact baselines are cashews-cached for 10 minutes under
  `backend:parser:impact_baselines:{discipline}:{FORMULA_VERSION}`. Every reader, including the
  backfill CLI, must call `configure_cache()` before cache operations.
- **Baseline input order.** The loader orders rows by `(match_id ASC, global user_id ASC)`
  before the unchanged pandas reductions. Stable identity ordering prevents query-planner row
  order from changing floating-point accumulation; formulas, rank handling and cache policy are unchanged.
- **Replicas are safe.** All three schedulers are leader-locked in Redis, and rank enqueue plus
  match-log parsing are deduped (Redis keys and content hash respectively), so scaling the worker
  horizontally does not duplicate work.
- **`ortools` is declared in `pyproject.toml` but never imported** — there is no OR-Tools
  optimisation in this service.
