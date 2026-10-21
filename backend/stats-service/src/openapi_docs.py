"""Human-readable docs (summary + description) for stats-service RPC subjects,
merged into the gateway's OpenAPI by the export script. Prose only.
"""

from __future__ import annotations

DOCS: dict[str, dict] = {
    # ── match-log admin ─────────────────────────────────────────────────────
    "rpc.stats.logs.queue_status": {
        "summary": "Match-log queue depths",
        "description": "Permission: global `log.read`. Returns per-status counts of match-log processing records.",
    },
    "rpc.stats.logs.history": {
        "summary": "List log processing records",
        "description": "Permission: `log.read` in the workspace named by the scope argument — `workspace_id`, else the tournament's, else the encounter's workspace — or global `log.read` when no scope argument is given. Lists match-log processing records filtered by tournament, encounter or workspace, plus optional status and free-text search, with pagination.",
    },
    "rpc.stats.logs.stats": {
        "summary": "Log processing stats",
        "description": "Permission: `log.read` in the workspace named by the scope argument — `workspace_id`, else the tournament's, else the encounter's workspace — or global `log.read` when no scope argument is given. Returns scope-wide processing counts per status, average completed duration and the newest record timestamp for a tournament, encounter or workspace.",
    },
    "rpc.stats.logs.retry": {
        "summary": "Retry log processing",
        "description": "Permission: workspace `log.update` in the record's workspace. Resets a failed or awaiting-link log record to pending, re-enqueues it for processing and returns the updated record (with its structured `error`, current `observation_revision`/`is_current_provenance` and, for an awaiting-link record, the document `teams` a bind map is keyed by), 404ing when the record does not exist. A `done` record is never replayed implicitly: 409 `reparse_required`; send `reparse=true` with the `expected_revision` the operator saw to replace its observations directly (409 `stale_revision` when another revision was written, 409 `stale_binding` once the job is no longer the game's current evidence). An optional `encounter_id` first attaches the log to that encounter of the record's tournament (404 unknown encounter, 400 another tournament's, 409 on a processed record), which is how an `encounter_ambiguous` failure is resolved.",
    },
    "rpc.stats.logs.upload": {
        "summary": "Upload match logs",
        "description": "Permission: workspace `log.create` in the tournament's workspace. Multipart (base64) upload of one or more log files for a tournament, storing each to S3 and enqueueing processing, with per-file errors collected. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    "rpc.stats.logs.process_tournament": {
        "summary": "Process tournament logs",
        "description": "Permission: workspace `log.update` in the tournament's workspace. Enqueues reprocessing of all stored match logs for a tournament and returns an ack message — the work itself runs asynchronously on the log queue — 404ing on an unknown tournament. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    # ── canonical match ingest ───────────────────────────────────────────────
    "rpc.stats.ingest.submit": {
        "summary": "Submit a canonical match document",
        "description": "Permission: a workspace API key whose `stats.ingest` scope is backed by the owner's effective `stats.ingest` permission; sessions, service tokens and owner privilege alone are refused (403 `api_key_required` / `scope_required`). The request body is the bare `owt.match/1` document (Content-Type `application/json`, up to 25 MiB); the workspace is always the key's own. Idempotent per `(source.kind, source.external_id)` when an external id is present, otherwise per the SHA-256 of the exact request bytes: the same bytes return the existing job, changed bytes or discipline under one external id answer 409 `idempotency_conflict`. Answers 202 with the job while it is `pending`/`processing`, and 200 with the actual job when it already finished (`done`, `awaiting_link`, `failed`; a failed duplicate is never retried implicitly). A structurally valid document whose codes do not resolve is persisted as a failed job with diagnostics and answers 422 with `ingest_job_id`; malformed JSON answers 400, a non-JSON content type 415, an oversized body 413.",
    },
    "rpc.stats.ingest.get": {
        "summary": "Read a canonical ingest job",
        "description": "Permission: same workspace API key and `stats.ingest` scope as submit. Returns the job's actual status, attempts, timestamps, structured error `{code,message,issues}` and, only while the job is still the current evidence of a match, its binding `{encounter_game_id,match_id,revision}`. A job of another workspace is indistinguishable from an absent one (404 `ingest_job_not_found`).",
    },
    "rpc.stats.ingest.game_observation": {
        "summary": "Read a game's current observation",
        "description": "Permission: workspace `log.read` in the game's workspace (404 `binding_target_not_found` for an unknown game). Returns the target game's authoritative current observation `{encounter_game_id, match_id, revision, ingest_job_id, is_historical}`; an unoccupied game answers `match_id`/`ingest_job_id` null and `revision` 0. `is_historical` marks an observation without a job or from a historical import, which no bind or reparse can replace. `revision` is what a bind's `expected_revision` must equal.",
    },
    "rpc.stats.ingest.bind": {
        "summary": "Bind an unlinked ingest job to a game",
        "description": "Permission: workspace `log.update` in the job's workspace. Binds an `awaiting_link` (or `failed`) job's stored document or raw source to `encounter_game_id` with the operator's complete `teams` map (`document team key -> encounter.team id`, a bijection onto the game's participating teams; a participant contradicting the chosen team is refused, zero overlap is allowed) and publishes it in the same transaction, returning the committed job. The client never sends the document. When the target game already has an observation `expected_revision` is required (`0` = none, `n` = replace exactly revision `n`) and is compared again under the final lock: 409 `stale_revision` / `expected_revision_required`. A `done` job is replayed only by retry with `reparse=true`; a busy job answers 409 `ingest_busy`. Refusals roll back and leave the job as it was: 404 `binding_target_not_found`, 409 `binding_mismatch` / `identity_conflict`, 422 `invalid_team_map`.",
    },
    # ── impact baselines ──────────────────────────────────────────────────────
    "rpc.stats.impact.recompute_baselines": {
        "summary": "Recompute impact baselines",
        "description": "Permission: superuser. Rebuilds the native Overwatch baselines used for MVP-impact scoring (`stats.stat_baseline`) for the active formula version, aggregating a mean/standard deviation per (role id, rank bucket, stat code) from whole-match player facts across workspaces. Returns the row count and formula version. Each run atomically replaces that discipline/version's rows and aborts rather than wiping them when aggregation yields nothing. Repeated runs are safe but scan the historical facts and clear the 10-minute baseline cache.",
    },
    # ── native rank collection ───────────────────────────────────────────────
    "rpc.stats.rank.user_history": {
        "summary": "User rank history",
        "description": "Permission: public; no authentication required. Returns a user's collected native rank time series with configurable granularity, date range, platform and role filters. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.game_account_history": {
        "summary": "Game account rank history",
        "description": "Permission: public; no authentication required. Returns one game account's rank time series (`discipline` names the game, default `overwatch`) with granularity, date range, platform and role filters; League series are per queue. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.user_current": {
        "summary": "Current user ranks",
        "description": "Permission: public; no authentication required. Returns a user's current collected native ranks for the requested platform. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.stats": {
        "summary": "Rank collection health stats",
        "description": "Permission: workspace `rank.read` when `workspace_id` is given (aggregates are then scoped to the game accounts of that workspace's players), otherwise global `rank.read`. Aggregated native rank-collection health: account state counts by status and priority tier, snapshot coverage over 24h/7d, last successful capture, last-24h fetch-outcome mix with error rate, upstream circuit state, and the active config. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.fetch_log": {
        "summary": "Rank fetch log",
        "description": "Permission: workspace `rank.read` when `workspace_id` is given (rows are then scoped to the game accounts of that workspace's players), otherwise global `rank.read`. Lists native rank-collection fetch-log entries filtered by status, source and cursor. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.user_collection": {
        "summary": "User rank collection status",
        "description": "Permission: workspace `rank.read` when `workspace_id` is given (empty unless the player is a member of that workspace), otherwise global `rank.read`. Returns the native rank-collection status for each of a user's game accounts. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.collect": {
        "summary": "Trigger rank collection",
        "description": "Permission: workspace `rank.update` when `workspace_id` is given (only that workspace's players' accounts are touched), otherwise global `rank.update`. Enqueues a native rank-collection run for a user or specific linked game accounts and returns the enqueued count. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    "rpc.stats.rank.reenable_disabled": {
        "summary": "Re-enable disabled rank collection",
        "description": "Permission: workspace `rank.update` when `workspace_id` is given (only that workspace's players' accounts are requeued), otherwise global `rank.update`. Requeues game accounts that were auto-disabled by a transient upstream outage (status disabled -> pending, failure counter reset), spreading them across the collection interval; optionally limited to accounts that previously succeeded. Returns the re-enabled count. `discipline` query parameter names the game (default `overwatch`); 404 `rank_collection_unsupported` for a game that collects no ranks.",
    },
    # ── subscription collection admin ─────────────────────────────────────────
    "rpc.stats.subscription.stats": {
        "summary": "Subscription collection health stats",
        "description": "Permission: workspace `subscription.read` when `workspace_id` is given (aggregates are then scoped to that workspace), otherwise global `subscription.read`. Aggregated subscription-collection health: entitlement counts by state and provider, distinct-user check coverage over 24h/7d, last successful check, last-24h check-outcome mix with error rate, the number of open tournaments enforcing a subscription, and the active config.",
    },
    "rpc.stats.subscription.check_log": {
        "summary": "Subscription check log",
        "description": "Permission: workspace `subscription.read` when `workspace_id` is given (rows are then scoped to that workspace), otherwise global `subscription.read`. Lists append-only subscription check-log entries (the collection history) filtered by state, source, provider, auth user and cursor.",
    },
    "rpc.stats.subscription.user_collection": {
        "summary": "User subscription collection status",
        "description": "Permission: workspace `subscription.read` when `workspace_id` is given (only that workspace's entitlement is returned), otherwise global `subscription.read`. Returns the current subscription entitlement per workspace and provider for one player.",
    },
    "rpc.stats.subscription.collect": {
        "summary": "Trigger subscription collection",
        "description": "Permission: workspace `subscription.update` when `workspace_id` is given (the re-check is then limited to that workspace), otherwise global `subscription.update`. Runs a live subscription re-check for one player (optionally limited to specific providers) or sweeps every open tournament that requires a subscription, and returns the number of checks performed.",
    },
    # ── achievement calculate ─────────────────────────────────────────────────
    "rpc.stats.ach.calculate": {
        "summary": "Run achievement calculation",
        "description": "Permission: workspace `achievement.update` in the payload's `workspace_id`. Runs the achievement condition-tree engine over one discipline of a workspace (the required `discipline` must be enabled for it; optionally seeding that discipline's built-in rules first and scoping the run to given slugs) and returns the slugs actually evaluated, rejecting unknown slugs and a missing workspace_id with 400. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    "rpc.stats.ach.calculate_tournament": {
        "summary": "Calculate tournament achievements",
        "description": "Permission: workspace `achievement.update` in the tournament's workspace. Runs the achievement engine for a single tournament — the workspace is taken from the tournament unless an explicitly matching workspace_id is supplied — and returns the tournament id plus the slugs evaluated, 404ing on an unknown tournament and 422 when the required `discipline` is not the tournament's. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    # ── achievement rules admin (workspace-scoped) ────────────────────────────
    "rpc.stats.ach.condition_types": {
        "summary": "List condition types",
        "description": "Permission: workspace `achievement.read`. Returns the catalog of achievement condition-tree leaf types the required `discipline` (query) can evaluate, with their grain; a discipline with no conditions returns an empty list.",
    },
    "rpc.stats.ach.validate": {
        "summary": "Validate condition tree",
        "description": "Permission: workspace `achievement.read`. Validates an achievement condition tree against the required `discipline` and returns errors plus the inferred grain.",
    },
    "rpc.stats.ach.list": {
        "summary": "List achievement rules",
        "description": "Permission: workspace `achievement.read`. Pages a workspace's achievement rules with search, category, and enabled filters: every game's, or only the optional `discipline`'s (422 `discipline_not_installed` for an unknown code). Each rule names its own `discipline`.",
    },
    "rpc.stats.ach.get": {
        "summary": "Get achievement rule",
        "description": "Permission: workspace `achievement.read`. Returns a single achievement rule scoped to the workspace.",
    },
    "rpc.stats.ach.create": {
        "summary": "Create achievement rule",
        "description": "Permission: workspace `achievement.create`. Creates a workspace achievement rule in the explicit `discipline` after validating its condition tree, its `entity_id` character and enforcing slug uniqueness (409 when the slug belongs to a rule of any discipline). The discipline is immutable afterwards; the retired `hero_id` is rejected.",
    },
    "rpc.stats.ach.update": {
        "summary": "Update achievement rule",
        "description": "Permission: workspace `achievement.update`. Updates an achievement rule, revalidating and bumping its version on condition-tree change and re-running evaluation. Omitted fields are unchanged, `entity_id: null` clears the character link, an explicit `{}` tree is an empty tree; `discipline` and the retired `hero_id` are rejected.",
    },
    "rpc.stats.ach.delete": {
        "summary": "Delete achievement rule",
        "description": "Permission: workspace `achievement.delete`. Deletes a workspace achievement rule and returns no content, 404ing when the rule does not exist in that workspace.",
    },
    "rpc.stats.ach.seed": {
        "summary": "Seed achievement rules",
        "description": "Permission: workspace `achievement.create`. Seeds the required `discipline`'s built-in achievement rules into a workspace and returns seeded/removed counts; other disciplines' rules are never touched, a same-slug rule of another discipline is a 409 and a discipline with no catalog is a 422, both before any write.",
    },
    "rpc.stats.ach.reset": {
        "summary": "Reset achievement rules",
        "description": "Permission: workspace `achievement.update`. Hard-resets one discipline of a workspace by reseeding its rules and clearing that discipline's evaluation results, returning the new run. Other disciplines' rules, results and overrides are untouched.",
    },
    "rpc.stats.ach.export": {
        "summary": "Export achievement rules",
        "description": "Permission: workspace `achievement.read`. Returns a portable v2 JSON export payload (`discipline` + `entity_id` per rule) of a workspace's achievement rules of the required `discipline`. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    "rpc.stats.ach.import": {
        "summary": "Import achievement rules",
        "description": "Permission: workspace `achievement.create` in the target workspace, plus membership of (or superuser over) the source workspace when one is named. Imports portable v2 achievement rules (each names its discipline) into a workspace and returns the import result. The whole batch is validated before any write: v1/`hero_id`, an unknown or foreign character, a disabled discipline or an invalid tree reject it (400/422), a slug owned by a rule of another discipline is a 409. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    "rpc.stats.ach.evaluate": {
        "summary": "Evaluate achievement rules",
        "description": "Permission: workspace `achievement.update`. Triggers a manual achievement evaluation run for the required `discipline`: explicit rule ids must be that discipline's rules, absent ids select its enabled rules, an empty list selects none; the optional tournament must belong to the workspace and discipline.",
    },
    "rpc.stats.ach.runs": {
        "summary": "List evaluation runs",
        "description": "Permission: workspace `achievement.read`. Returns the 50 most recent achievement evaluation runs for a workspace.",
    },
    "rpc.stats.ach.rule_users": {
        "summary": "List rule's qualifying users",
        "description": "Permission: workspace `achievement.read`. Returns a paginated, sortable list of users who earned a rule's achievement with counts and first-qualified timestamps.",
    },
    "rpc.stats.ach.test": {
        "summary": "Test achievement rule",
        "description": "Permission: workspace `achievement.update`. Dry-runs a rule's condition tree (in the rule's own discipline) against an optional tournament of that discipline and returns the qualifying count plus a sample of results.",
    },
    "rpc.stats.ach.lib_workspaces": {
        "summary": "List library workspaces",
        "description": "Permission: workspace `achievement.read`. Lists other workspaces (visible to the caller) that have achievement rules of the required `discipline` available to import as a library.",
    },
    "rpc.stats.ach.lib_list": {
        "summary": "List library rules",
        "description": "Permission: workspace `achievement.read` in the target workspace, plus membership of (or superuser over) the source workspace. Lists the source workspace's achievement rules of the required `discipline` available for library import.",
    },
    "rpc.stats.ach.lib_import": {
        "summary": "Import library rules",
        "description": "Permission: workspace `achievement.create` in the target workspace, plus membership of (or superuser over) the source workspace. Imports selected achievement rules of the required `discipline` from a source workspace's library into the target workspace, warning on missing slugs; the same all-or-nothing validation as a portable import applies. Metered: over quota the call answers 429 with `code=rate_limited` and the exceeded limit in `details.limit_name`.",
    },
    "rpc.stats.ach.overrides_list": {
        "summary": "List achievement overrides",
        "description": "Permission: workspace `achievement.read`. Lists manual grant/revoke achievement overrides of the required `discipline` for a workspace.",
    },
    "rpc.stats.ach.override_create": {
        "summary": "Create achievement override",
        "description": "Permission: workspace `achievement.update`. Creates a manual achievement override (grant or revoke) for a user on a rule, stamped with the granting actor; a tournament or match it names must belong to the rule's workspace and discipline and agree with each other.",
    },
    "rpc.stats.ach.override_delete": {
        "summary": "Delete achievement override",
        "description": "Permission: workspace `achievement.update`. Deletes a manual achievement override scoped to the workspace.",
    },
    # ── catalog sync ──────────────────────────────────────────────────────────
    "rpc.stats.catalog.sync": {
        "summary": "Sync a discipline's catalog",
        "description": "Permission: superuser only. Pulls the discipline module's catalog source (Overwatch: OverFast; League of Legends: Data Dragon) into catalog.entity, mirroring images to S3; existing rows keep their name and attrs; an existing parent is kept; a missing one is filled from the source; nothing is deleted. 404 for a discipline without a sync.",
    },
    # ── global settings ─────────────────────────────────────────────────────
    "rpc.stats.settings.list": {
        "summary": "List global settings",
        "description": "Permission: superuser. Returns all global key/value settings.",
    },
    "rpc.stats.settings.get": {
        "summary": "Get global setting",
        "description": "Permission: superuser. Returns a single global setting by key.",
    },
    "rpc.stats.settings.upsert": {
        "summary": "Upsert global setting",
        "description": "Permission: superuser. Creates or updates a global setting by key, stamping the updating user.",
    },
}
