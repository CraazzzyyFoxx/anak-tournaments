# Multi-game P5 canonical ingest: release note, public protocol and cutover runbook

P5 puts match ingestion behind one game-neutral protocol. A producer (a game module's decoder, a league
tool, a script) sends one `owt.match/1` document with a workspace API key; `stats-service` validates it,
binds it to an encounter game, replaces that game's observations atomically and announces the result;
the match layer alone decides whether those observations become an official result. The Overwatch
Workshop log is now an Overwatch *module decoder* that produces the same document. See the
[architecture](../architecture.md), the [stats-service README](../../backend/stats-service/README.md),
the [ERD](../database_erd.md#stats) and the [P4 release facts](../../backend/README.md#p4-statistics-cutover-stats01).

Deploy backend services, gateway schemas, nginx and frontend together: there is no old-wire
compatibility layer, no alias queue and no `parser-*` service. Take and verify a restorable backup
before the maintenance window. The migration (`ingest01`, parent `stats01a`) is forward-fix only:
rollback after commit means restoring that backup and the matching old images, never
`alembic downgrade`. **This note records local implementation evidence, not a timed production
migration; it is not permission to delete any old schema.** The production rehearsal, the maintenance
deployment and every legacy drop belong to the future P9 release.

## 1. The public protocol

* **Endpoint:** `POST /api/v1/stats/matches`, `Content-Type: application/json`, body = the bare document
  (never an envelope), `Authorization: Bearer <workspace API key>`.
* **Schema:** the request schema in the OpenAPI is the actual strict model, not a hand-written
  attachment: component `stats.MatchDoc` (response `stats.IngestJobRead`) in
  [`gateway/internal/openapi/schemas.json`](../../gateway/internal/openapi/schemas.json); served live at
  `/api/docs` (group **Match Ingest**) and `/api/openapi.json`. The Python source of truth is
  [`backend/shared/schemas/match_doc.py`](../../backend/shared/schemas/match_doc.py). Unknown fields are
  refused at every level; duplicate JSON keys, invalid UTF-8, non-finite numbers and nesting deeper than
  32 are refused.
* **Example** (every reference below is declared; this exact text is parsed by a test in the suite):

```json
{
  "protocol": "owt.match/1",
  "discipline": "overwatch",
  "source": {"kind": "external", "external_id": "league-r3-m7-g1"},
  "hint": {"encounter_game_id": 4821},
  "played_at": "2026-10-15T19:30:00Z",
  "duration_s": 612.5,
  "map": "ilios",
  "teams": [
    {"key": "alpha", "placement": 1},
    {"key": "beta", "placement": 2}
  ],
  "participants": [
    {"key": "p1", "team": "alpha", "identity": {"provider": "battlenet", "id": "Ana#1234"},
     "role": {"dimension": "player_role", "role": "support"}},
    {"key": "p2", "team": "alpha", "identity": {"provider": "battlenet", "id": "Reaper#2345"}},
    {"key": "p3", "team": "beta", "identity": {"provider": "battlenet", "id": "Mercy#5678"},
     "role": {"dimension": "player_role", "role": "support"}},
    {"key": "p7", "team": "beta", "identity": {"provider": "battlenet", "id": "Genji#7777"}}
  ],
  "segments": [{"index": 1, "kind": "round", "attrs": {}}],
  "facts": [
    {"team": "alpha", "stat": "score", "value": 2},
    {"team": "beta", "stat": "score", "value": 1},
    {"participant": "p1", "stat": "eliminations", "value": 14, "entity": "ana", "segment": 1}
  ],
  "events": [
    {"t": 41.25, "type": "kill", "actor": "p1", "target": "p7", "entity": "ana", "segment": 1}
  ]
}
```

Field rules worth knowing before writing a producer:

* `source.kind` is bounded provenance (≤ 32 chars), **not** a decoder selector; `source.external_id`
  (≤ 128) is the idempotency key (section 4). `hint` (`encounter_game_id` / `encounter_id` /
  `tournament_id`) only narrows candidates, never authorises (section 8).
* `participants[].role` is a `RoleRef {dimension, role}`: the discipline's rated dimension and a root
  or workspace-owned leaf role; there is no scalar role string. `parent` is derived, never trusted.
* A participant's identity is `{provider, id}` with the provider's own handle grammar (battlenet
  `Name#1234`, riot `Name#TAG`); the grammar is enforced for canonical producers only (decoded Workshop
  documents carry bare Workshop names).
* `facts` have exactly one of `participant` / `team`; stat, event and entity codes are the discipline's
  catalog vocabulary (`stats.stat_def`, `stats.event_type`, `catalog.entity`). `segment` 0 is the whole
  match; other segments must be declared.
* `teams[].placement` (1-based, ≤ team count) is what the match layer may turn into an official result.
  `teams[]` order is stored as `source_position`; team keys are opaque.
* For a **canonical** producer every event must satisfy `0 ≤ t ≤ duration_s` (`event_after_end`).
  Decoded Workshop documents are exempt: real logs contain post-end events and P4 accepted them.

## 2. API keys: issue, rotate, revoke, delegate

The required scope is exactly **`stats.ingest`** (a normal catalog permission, `resource.action` like
every other scope; there is no `stats:ingest` alias). The workspace is always the key's own: nothing in the
body selects a workspace or key.

1. A workspace member who holds `stats.ingest` in that workspace (the workspace `admin` role does; the
   `referee`, `host` and `player` roles do not) signs in and creates the key. Key management is a
   **session-only** surface: a key can never mint or revoke another key.

   ```bash
   curl -sS -X POST "$STATS_API_URL/api/v1/auth/api-keys" \
     -H "Authorization: Bearer $SESSION_ACCESS_TOKEN" -H "Content-Type: application/json" \
     --data '{"name":"league-bot","workspace_id":7,"scopes":["stats.ingest"],"expires_at":"2027-01-01T00:00:00Z"}'
   ```

   The response carries the raw `owt_sk_…` key **once**; store it in the producer's secret store. Only a
   hash is kept.
2. **Delegation.** A key is grantable only while its owner holds `stats.ingest` there, and its effective
   permission is the intersection of its scopes and what the owner holds *now*: an owner role change or
   deny removes it on the next validation, and a superuser-backed key still cannot act in another
   workspace. Give a producer its own low-privilege account, grant that account `stats.ingest` through a
   workspace role, and let it mint the key.
3. **Rotation.** Create the replacement key, deploy it to the producer, confirm
   `GET /api/v1/auth/api-keys/self` answers with it, then revoke the old one:
   `DELETE /api/v1/auth/api-keys/{id}` (204). A revoked or expired key is refused with 401; the gateway caches a
   credential's verdict for up to 30 s, so allow that long for it to take effect everywhere.
4. **Rate limit.** Each key is metered per minute by its quota plan (60/min by default; the gateway
   answers 429 with `Retry-After`). A producer that polls should back off rather than raise the limit; an
   operator may retune one key through `PUT /api/v1/auth/api-keys/{id}/quota`.

Every example below reads the key from the environment and never prints it:

```bash
export STATS_API_URL=http://127.0.0.1:8080        # the local gateway
# STATS_API_KEY is exported by your shell/secret manager; never paste it into a file or a ticket.
```

## 3. Submitting and polling

```bash
curl -sS -i -X POST "$STATS_API_URL/api/v1/stats/matches" \
  -H "Authorization: Bearer $STATS_API_KEY" -H "Content-Type: application/json" \
  --data-binary @match.json
```

Use `--data-binary`: the server hashes the **original request bytes**; `curl -d` strips newlines and
changes them. The gateway relays the bytes untouched (it does not decode and re-marshal the body).

The reply is the job, flat (HTTP v1): `202` while it is `pending`/`processing`, `200` for any other
state (a duplicate of a finished job answers `200` with that job).

```json
{"id": 311, "workspace_id": 7, "discipline": "overwatch", "source_kind": "external",
 "external_id": "league-r3-m7-g1", "content_hash": "…sha256 of the bytes…", "status": "pending",
 "attempts": 0, "created_at": "…", "updated_at": null, "started_at": null, "finished_at": null,
 "error": null, "binding": null}
```

Poll the job through the same public surface:

```bash
curl -sS "$STATS_API_URL/api/v1/stats/ingest-jobs/311" -H "Authorization: Bearer $STATS_API_KEY"
```

Poll once a second for the first few seconds, then back off to 5-10 s; stop at a terminal state. A job of
another workspace (or an absent id) is the same `404 ingest_job_not_found`.

| `status` | Meaning | What the producer does |
| --- | --- | --- |
| `pending` | Accepted and queued (on the outbox until the tournament process publishes it, then on `stats.ingest.<discipline>`) | Keep polling |
| `processing` | A worker holds the claim | Keep polling; a stalled claim is reclaimed by the reaper |
| `awaiting_link` | Valid, but no unique game is proven by the participants' rosters. **Nothing was written.** | Ask an operator to bind it (section 7), or fix the identities and submit under a new `external_id` |
| `done` | Observations are stored; `binding {encounter_game_id, match_id, revision}` names the game | Done. `binding` is absent once a later document replaced this one |
| `failed` | Terminal; `error {code, message, issues[]}` says why | Fix the cause (section 9) and submit a corrected document under a new `external_id` |

### Error table

Errors are flat in HTTP v1: `{"detail", "code", "fields":[{"code","msg"}], …}`. **Extract the machine code as:
the field-level code `fields[0].code` when `fields` is present, otherwise the top-level `code`.** Errors raised by
the service carry `fields` (the top-level `code` is then only the HTTP class, e.g. `forbidden`, `unprocessable`);
errors produced by the gateway itself (`413 match_document_too_large`, `415 unsupported_media_type`, 401, 429, 503)
have no `fields`, and their top-level `code` is the machine code. `ingest_job_id` and `issues[]` are top-level
members when they apply.

| HTTP | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_json` / `invalid_utf8` / `invalid_document` / `invalid_request` | Not JSON, not UTF-8, duplicate keys or a non-object top level |
| 401 | — | Missing, malformed, unknown, revoked or expired key |
| 403 | `api_key_required` | A session or service token (only a real workspace key may submit) |
| 403 | `scope_required` | The key lacks `stats.ingest` or its owner no longer holds it |
| 403 | `discipline_disabled` | The workspace has not enabled that discipline |
| 404 | `binding_target_not_found` | A `hint` names a tournament/encounter/game outside the key's workspace |
| 404 | `ingest_job_not_found` | Unknown id, or a job of another workspace |
| 409 | `idempotency_conflict` | Section 4 |
| 409 | `stats_upload_scope_conflict` / `stored_document_invalid` | The same bytes collide with a raw upload job of another scope / a submit collided with an existing job whose stored envelope is missing or invalid (submit only; admin and worker paths below) |
| 413 | `match_document_too_large` | More than 25 MiB (section 10) |
| 415 | `unsupported_media_type` | Not `application/json` |
| 422 | `unsupported_protocol` / `document_invalid` / `unsupported_discipline` | Wrong `protocol`, schema violations with located `issues[]`, an unregistered discipline |
| 422 | `unknown_code` | A stat/event/entity/role code is unknown to the catalog. **A failed job was persisted** (`ingest_job_id`); `issues[]` carries `kind` + `raw_name` |
| 429 | — | Per-key rate limit; honour `Retry-After` |
| 503 | `ingest_unavailable` | Storage or broker unavailable; nothing was committed; retry after `Retry-After: 1` |

## 4. Idempotency and conflicts

* With `source.external_id`: the key is `(workspace, source.kind, external_id)`. The **same bytes**
  return the existing job (nothing is re-run; a `failed` duplicate is *not* retried implicitly). **Changed
  bytes or a different discipline answer `409 idempotency_conflict`** and change nothing.
* Without it: the key is `(workspace, sha256 of the request bytes)`. Whitespace and key order are part
  of the bytes: re-serialising a document is a new submission.
* There is no replacement under an existing key. A **corrected document gets a new `external_id`**
  (section 6).
* Concurrent identical requests converge on one job, one revision and one `match.ingested` event.

## 5. Observed versus official

Observations (`stats.match`, `fact`, `event`) are **statistics**; they are never an official game result.
The official decision is a separate transaction in the match layer.

* A tournament has `logs_official` (default **false**; changed through the tournament update with
  `tournament.update`; a Challonge import never sets it).
* Every stored revision publishes `match.ingested` (id `match.ingested:{match_id}:{revision}`) with the
  canonical placements, the basis result version and any extra participants. The tournament process
  consumes it and writes one `match_ingested` receipt on the encounter journal with an `outcome`:
  `accepted`, `logs_disabled`, `owner_policy_refused`, `result_locked`, `stale_basis`,
  `result_incomplete`, `applied_roster_only`. Missing events (a missing game or encounter) and
  duplicates are not journaled.
* **Roster (owner policy, independent of `logs_official`).** For a tournament owner, a live encounter and the exact
  bound team set, valid extra participants are seated as encounter substitutes under the roster's own rank/role rules
  whatever `logs_official` says and whatever the game's result state is (the P4 parser always seated them). Mix and
  scrim owners never take roster additions. When extras are seated but the result is refused, the outcome is
  `applied_roster_only` and the receipt `reason` is the result refusal (`logs_official_off`, `game_confirmed`,
  `placements_missing`, …).
* **Result.** Only with `logs_official` on, for an undecided, uncancelled game of a live, undecided encounter whose
  result version still equals the evidence basis, the placements become an `admin_log` result (placement-only:
  `win` is the sole first place; no scores are invented). A Push/Clash log writes `0:0` whoever won, so the
  Overwatch decoder emits **no placements** for those modes: the evidence is journaled `result_incomplete`
  (`placements_missing`) and the organizer enters the result.
* **Precedence.** An organizer's own result (admin entry, captain agreement, an import, a confirmed
  game) is never overwritten: later evidence is journaled `result_locked`. The first accepted evidence
  stands; a reparse or a later revision never replaces it (a correction uses the existing explicit
  correction/reopen path). **No public hint and no reparse overrides an administrator's result.**
* The evidence queue (`match.ingested.tournament`) has a 10-minute TTL with its own DLQ: if the tournament
  process is down longer, the receipt is lost to the DLQ; a reparse produces a new revision and a new decision.

## 6. Corrected-document workflow

1. The job is `failed` (or `done` with wrong data). Read `error.issues[]` (section 9).
2. Fix the producer or the catalog. Submit the corrected document with a **new `source.external_id`**.
3. If the participants' rosters identify exactly one game, the new document **replaces that game's
   observations automatically and atomically** (one transaction; no partial replacement), the revision
   increments and the older job's `binding` disappears. An occupied game is not sent to an operator:
   occupancy is evidence, not authority. A `hint` alone never makes a document replace anything.
4. Historical observations (imported from the old parser) are never replaced by a canonical document.

## 7. Administrator operations

All routes are workspace-checked admin routes (a session, not a key):

* `GET /api/v1/admin/logs/games/{encounter_game_id}/observation` (`log.read`) →
  `{encounter_game_id, match_id|null, revision (0 = unoccupied), ingest_job_id|null, is_historical}`.
  `revision` is the `expected_revision` for the next write; `is_historical` observations can never be
  replaced.
* `POST /api/v1/admin/logs/{job_id}/bind` (`log.update`) with
  `{"encounter_game_id": 4821, "teams": {"alpha": 9001, "beta": 9002}, "expected_revision": 0}` binds an
  `awaiting_link` (or failed-but-stored) document with the operator's **complete** team map
  (`document team key → encounter.team id`; a bijection onto the game's seats, zero participant overlap
  allowed, a roster contradiction refused). The target must be unoccupied (`expected_revision` 0) or
  carry exactly the revision the operator saw. Returns the job (`done`, with `binding`).
* `POST /api/v1/admin/logs/{job_id}/retry` with `{"reparse": true, "expected_revision": 1}` re-runs a `done`
  job against its stored document (a `done` retry without `reparse` is `409 reparse_required`); it
  produces a new revision only if the revision still matches.
* Refusals (all 409 unless noted, code in `fields[0].code`): `expected_revision_required`, `stale_revision`,
  `stale_binding`, `binding_mismatch`, `identity_conflict`, `invalid_team_map` (422),
  `binding_target_not_found` (404), `map_not_in_pool` (400), `ingest_busy`, `ingest_pending`,
  `job_not_done`. A refusal leaves the job row as it was.
* **Tournament-wide reprocess** (`POST /api/v1/logs/{tournament_id}`) selects only jobs that carry that tournament's
  hint (`hint_tournament_id`: uploads and documents whose `hint.tournament_id` was given); a canonical job submitted
  without a tournament hint is never selected. Jobs being processed are left alone, and historical or refused jobs
  (non-`raw_available` raw state, shared-source, unbound-historical, owner mismatch) are skipped. `pending`, `failed` and
  `awaiting_link` jobs are re-queued on `stats.ingest.<discipline>`. A `done` job is replayed through the **TTL-less**
  durable `stats.ingest.<discipline>.replay` queue, with the revision seen at selection, **only while it is still the
  current provenance of its observation**: a superseded or unbound done job is untouched. Stale or busy jobs are logged and
  acknowledged, never forced. The command is therefore not proof that every completed submission was reparsed.
* Observation-only identities. People named by a document who are not members of the workspace get a
  virtual player and a workspace *anchor* (`workspace_member.observed_only`): never a membership, never a
  role, never visibility, never a revived removed member; they are excluded from every membership/visibility
  read and from link-time role autofill, and become members only through a real admission.

## 8. Hints are narrowing, never authority

`hint.encounter_game_id|encounter_id|tournament_id` filters candidate games. A hint outside the key's workspace
is `404 binding_target_not_found` (nothing persisted); a hint that the rosters contradict does not bind (the
job fails or waits); a hint never authorises a takeover of an occupied game, and a reparse never overrides an
administrator's result (section 5).

## 9. Diagnostics triage

A `failed` job keeps its structured `error {code, message, issues[]}`; each issue is `{path, code, message}`
plus, for vocabulary misses, `kind` and `raw_name`. Misses are also upserted into `catalog.alias_miss` with an
occurrence counter and the last job id, **even though the observations were rejected**:

| `kind` | `raw_name` | Fix |
| --- | --- | --- |
| `character`, `map`, `mode` | the unknown name/slug | Attach it as an alias of the intended entity (`POST /api/v1/admin/catalog-aliases/attach`) or add the entity |
| `stat`, `event` | the unknown code | Add the code to the discipline's module vocabulary (a code change, then catalog sync); read/dismiss only |
| `role` | `dimension:role` | Create the workspace role or correct the producer; read/dismiss only |

`GET /api/v1/admin/catalog-aliases/misses` lists the queue; `POST …/misses/{id}/dismiss` closes one. Non-entity
kinds are never attached and never auto-create a definition. After fixing, resubmit under a new `external_id`.

## 10. Body caps

| Where | Cap |
| --- | --- |
| Gateway canonical relay (`POST /api/v1/stats/matches`) | 25 MiB: `Content-Length` over it is refused before reading, an undeclared stream is cut at the cap (`413 match_document_too_large`) |
| nginx | exact `location = /api/v1/stats/matches` with `client_max_body_size 25m`, edge limiting and a connection cap (default 12m elsewhere; admin log upload 60m) |
| Worker / RPC | `MAX_MATCH_LOG_BYTES` 25 MiB; the base64 length is bounded before it is decoded |
| Raw Workshop upload (admin/bot) | the existing 50 MiB multipart relay, then the 25 MiB log cap and `MAX_MATCH_LOG_LINES` 500k in the Overwatch decoder |

## 11. Worker configuration: two processes

`stats-service` is one image and **two processes**:

* `stats-svc` — `faststream run serve_rpc:app`: only the typed `rpc.stats.*` handlers (including
  `rpc.stats.ingest.submit|get|bind|game_observation`). No consumer, no schedule.
* `stats-worker` — `faststream run serve_worker:app`: `stats.ingest.<discipline>` and its `.replay` queue (one
  channel each, so a slow log stalls neither the other game nor the fanout), upload and tournament fanout,
  achievements (normal/deferred), `tournament_encounter_completed`, the selected disciplines' own jobs (the
  OverFast rank fetch and both registration rank checks for Overwatch) and the reaper, failed-log retention,
  rank and subscription schedules.

`STATS_DISCIPLINES` (comma-separated installed codes, e.g. `overwatch,lol`) selects the disciplines a worker
serves; unset serves every installed one. An empty value, an empty entry, a duplicate or an unknown code stops
**both** processes at startup. Run one worker per game (or several) to isolate their queues: a worker never
consumes, declares or replays a discipline it did not select, and a job delivered to the wrong queue is
rejected to the DLQ untouched. Both processes expose `GET /health` on `WORKER_METRICS_PORT` (`200` only once
the broker connection is up and every consumer of the process runs; `503` with the reason otherwise).

Reaper (`LOG_REAPER_*`, worker): a `processing` claim older than `LOG_REAPER_PROCESSING_AFTER_SECONDS` (1800)
or a `pending` job older than `LOG_REAPER_PENDING_AFTER_SECONDS` (900; keep it above the 5-minute queue TTL) is
re-requested through the outbox, at most `LOG_REAPER_MAX_ATTEMPTS` times. Claims are fenced by
`(attempts, started_at)`: a worker that wakes up holding a superseded claim commits nothing.

## 12. Cutover matrix (no aliases)

| Area | Before | After |
| --- | --- | --- |
| Service / compose | `parser-svc` | `stats-svc` (RPC, 0.5 cpu/256M) + `stats-worker` (1.0 cpu/512M) |
| Image | `ghcr.io/…/owt-parser`, `APP_PATH=parser` | `ghcr.io/…/owt-stats`, `APP_PATH=stats` |
| Directory / package | `backend/parser-service`, `gateway/internal/parser` | `backend/stats-service`, `gateway/internal/stats` |
| Env file | `backend/env/parser.env` | `backend/env/stats.env` (+ `STATS_DISCIPLINES`); `PARSER_URL`, `SERVICE_CLIENT_*` removed from `discord.env` |
| Makefile | `parser-logs/-restart/-rebuild` | `stats-logs/-restart/-rebuild` (both containers) |
| RPC subjects | `rpc.parser.*` | `rpc.stats.*` (plus new `rpc.stats.ingest.*`); OpenAPI schema prefix `stats.` |
| Public routes | — | `POST /api/v1/stats/matches`, `GET /api/v1/stats/ingest-jobs/{id}`; admin `POST …/logs/{id}/bind`, `GET …/logs/games/{id}/observation`, `retry` gains `reparse`/`expected_revision` |
| Ingest queue | one `process_match_log` (+ `.dlq`) | `stats.ingest.<discipline>` (+ `.dlq`, TTL 5 min) and `stats.ingest.<discipline>.replay` (+ `.replay.dlq`, **no TTL**) |
| Event | `ProcessMatchLogEvent` (`process_match_log`) | `ProcessIngestJobEvent` (`process_ingest_job`; optional `reparse_expected_revision` only on `.replay`) |
| Evidence wire | — | `MatchIngestedEvent` on exchange `match.ingested`, queue `match.ingested.tournament` (+ `.dlq`, TTL 10 min) |
| Metrics | `parser` job/instance labels | scrape jobs `stats-svc`, `stats-worker`; counters `stats.ingest.processed`, `stats.ingest.reclaimed`, `stats.ingest.replayed` |
| Quota operations | `parser.logs.upload`, `parser.logs.process_tournament` | `stats.logs.upload`, `stats.logs.process_tournament` (costs unchanged; `ingest01` renames the rows); public submit charges `stats.logs.upload` |
| Redis quota counters | — | **No key migration**: usage counters are keyed by principal and day, not by operation code, so existing counters continue across the rename |
| API-key scope | — | `stats.ingest` |
| Tournament | — | `tournament.logs_official` (default false); evidence consumer in `tournament-service` |
| Storage | `logs/{tournament}/{content_hash}` | **Unchanged and preserved** for historical and raw uploads; canonical documents add `stats/raw/{workspace}/{sha256}` and `stats/documents/{workspace}/{sha256}.json` |
| Schema | `stats01a` head | `ingest01`: `catalog.alias_miss.kind` + `stat\|event\|role`, `tournament.logs_official`, `workspace_member.observed_only`, quota slug rename (the `ingest_job.document_ref` / `api_key_id` columns are P4's `stats01`) |

"No aliases" means no compatibility shim for a renamed contract. These identifiers **deliberately keep the old
namespace** because they are stored data or keys, not service names: the `parser.ach.*` quota operations (achievement
RPCs), the `parser.rank_collection` / `parser.rank_mapping` / `parser.subscription_collection` settings keys, and the
`backend:parser:impact_baselines` cache key. Renaming them is a data migration, not part of this cutover.

Contract rulings that changed a wire, protocol or storage contract (each also documented where used above):

1. Scope literal `stats.ingest`; no alias; real key + literal scope + effective owner permission + exact workspace.
2. Provider handle grammar and `event_after_end` apply to **canonical producers only**, not decoded Workshop documents.
3. Idempotency key `(workspace, source.kind, external_id)` else `(workspace, content_hash)`; same bytes → existing job,
   changed bytes/discipline → `409 idempotency_conflict`; no discipline in either index.
4. `workspace_member.observed_only` — observation anchors are never members, visible or authorised.
5. `tournament.logs_official` default false; observations and official decisions are different transactions.
6. Per-discipline `stats.ingest.<slug>` and TTL-less `.replay` queues; a worker serves only its selected disciplines.
7. Quota slugs `stats.logs.*`; usage counters unchanged in Redis.
8. The retired `process_match_log` queue is not consumed by anything: see section 13.
9. `ProcessIngestJobEvent` replaces the job event (same payload fields, new type string).
10. `MatchIngestedEvent` wire: event id `match.ingested:{match_id}:{revision}`, placements, basis result version, extra participants with a `RoleRef`.
11. Placement rule: canonical placements only (`GameResultIn(score=None, placement=…)`); a complete placement set derives `win` from the sole first place; the Overwatch decoder derives placements from observed team scores (higher → 1, equal → both 1) **except** in Push/Clash (`OBJECTIVELESS_GAMEMODES`), whose `0:0` end is a log artifact: no placements, journaled `result_incomplete`.
12. Virtual (observation-only) identities are not globally visible (`ensure_global_visibility=False`).
13. `alias_miss.kind` widens to `stat|event|role` for diagnostics only; `catalog.entity.kind` and `CATALOG_KINDS` stay three.

14. **Document envelope.** The server stores each document as a minimal internal envelope `{"document": MatchDoc, "producer":
    "canonical"|"decoded"}` at `stats.ingest_job.document_ref` (`stats/documents/{workspace}/{sha256}.json`); the producer
    is assigned by the server, never by the caller, and the public API only ever accepts the bare `MatchDoc`. Only a raw
    job without a `document_ref` runs a registered decoder, and it persists `decoded`. Retries, reparses and admin bind
    preserve the producer. Provenance is never inferred from a filename, an object path or `source.kind` (no new database
    column); an envelope that is missing or not exactly `{document, producer}` fails by operation: a **submit** that collides with such a job is `409 stored_document_invalid`; an **admin bind or reparse** that loads it is `422` with code `stored_document_invalid` (the stored-document failure has no dedicated admin status mapping, so the status falls back to 422; the code is not `document_invalid`; the job row is left as it was); and the **worker** marks the job `failed` with the structured error. Raw
    `raw_ref`/`content_hash` still identify the original bytes.
15. **Receipt contract.** The evidence consumer takes the encounter lock, then the game lock, and writes one durable
    `encounter.room_event` (`action = match_ingested`) in the same transaction as any result change. `data` carries the
    game id, evidence id, revision, event id, `basis_game_result_version` (the result version the evidence was computed
    against), the accepted game-result version after the decision and the `outcome`; a short refusal code goes in the journal entry's `reason`. Duplicate and
    out-of-order delivery is decided from the **full scoped journal** (a direct query by encounter, action, `data.game_id`
    and `data.evidence_id`, not the UI's history window): a delivered revision or event id is a duplicate, a revision
    below the highest delivered one is `stale_revision` (an equal revision is a `duplicate`), and the high-water mark never claims to know a later, unseen stats
    revision. A stale basis is refused even at a higher revision; a failed transaction leaves neither receipt nor result.

## 13. P9 maintenance release: old queues, drain, rollback

This release deliberately does **not** drain or delete anything. The future P9 maintenance release must:

1. **Inventory before cutover.** `process_match_log` and `process_match_log.dlq` are retired: no new image consumes
   them and nothing auto-deletes them. Record their depth (RabbitMQ management or `rabbitmqctl list_queues name
   messages consumers`) and the count of `stats.ingest_job` rows in `pending`/`processing`.
2. **Stop producers, then old consumers.** Stop the old `parser-svc` consumers *after* the queue is empty
   (or accept that the rows stay `pending`): a message left on `process_match_log` is never delivered by the new
   images. Pending rows are re-requested onto the new per-discipline queues by the reaper once they are older than
   `LOG_REAPER_PENDING_AFTER_SECONDS`; `processing` rows are reclaimed after their window. Do not republish
   old payloads by hand.
3. **Cut over images together** (`owt-stats`, gateway, tournament, app, identity, discord, frontend, nginx),
   then confirm `GET /health` on `stats-svc` and `stats-worker`, one consumer per selected `stats.ingest.<slug>`
   and `.replay`, and the evidence consumer on `match.ingested.tournament`.
4. **Delete the retired queues** (`process_match_log`, `process_match_log.dlq`) only after both are empty and
   the old consumers are gone.
5. **Rollback** is restore of the verified backup plus the matching old images, in that order; never
   `alembic downgrade`. Objects written by P5 (`stats/raw/…`, `stats/documents/…`) are unreferenced after a restore and
   harmless; historical `logs/…` objects were never rewritten.

## 14. P4 historical data blockers (unchanged by P5)

P5 does not resolve, and this smoke does not remove, the P4 blockers on the dev data: the raw inventory read
7,367 keys, **7,214 valid, 153 missing** (145 parsed matches plus eight unlinked records), one stored-hash conflict,
28 duplicate candidate keys and 18 keys shared by 36 parsed matches that need an explicit ownership decision; no
historical versions or backups of the missing/conflicting objects exist, and four same-basename candidates in
`aqt-dvor/logs/1` have NULL hashes and unproven provenance. The game proposal (6,986 planned creations, 56 NULL-map
fills, five links, 103 already resolved) was never applied, and 198 matches are held (106 without a timestamp, 86
without an original-position anchor, four conflicts with occupied official positions, two chronology/ownership
conflicts). Required before any production switch: authentic bytes and provenance for the missing/conflicting keys,
exact ownership/order decisions for the held matches and duplicate-reference resolution. Do not invent hashes,
truncate history or replace confirmed results. Historical jobs keep `raw_status` `missing`/`conflict`/`unverified`;
reparse and download refuse them rather than guess.

**P9 gate: real Workshop-log decoder parity.** The decoder was verified against the synthetic Task 0 fixture only
(the repository holds no authentic Workshop bytes, and committing real logs would publish players' BattleTags). Before
production, run one real dev raw log through the P4 parser at the last P4 commit and through `decode` + `derive_match`,
and compare the facts, events and score; record only the log SHA and pass/fail. Real-log quirks (post-end events,
Push/Clash `0:0`, odd stat rows) are otherwise first seen in production.

## 15. Local verification recipe

The opt-in live smoke `backend/stats-service/tests/test_ingest_live_smoke.py` (`RUN_P5_LIVE_SMOKE=1`) starts the real
processes (stats `serve_rpc` and two `serve_worker`s with `STATS_DISCIPLINES=overwatch` and `lol`, identity, tournament
outbox/evidence consumer, the built Go gateway) against real PostgreSQL, RabbitMQ, Redis and an S3-compatible store. The
fixture creates and drops its own scratch database `test_p5_ingest_<uuid>`, RabbitMQ vhost, S3 bucket and Redis database;
it refuses a non-loopback dependency or a non-test database before any DDL, and never touches `anak_test` itself. It
writes `evidence.json` (commands, process pids, readiness checks, job ids, status transitions, match ids, revisions,
observation counts, outbox event ids, receipt outcomes, exit codes) and redacted logs to a temp directory (override
with `P5_SMOKE_EVIDENCE_DIR`), never under tracked source and never with a key, token or password.

Run from the repository root in a POSIX shell with Docker. The fixed container names intentionally fail if they
already exist: never stop someone else's container to make the recipe pass.

```bash
docker compose -f docker-compose.test.yml up -d --wait
docker run -d --rm --name owt-p5-rabbit -p 127.0.0.1:55672:5672 -p 127.0.0.1:55673:15672 -e RABBITMQ_DEFAULT_USER=p5smoke -e RABBITMQ_DEFAULT_PASS=p5smoke-local-only rabbitmq:3.13-management
docker run -d --rm --name owt-p5-redis -p 127.0.0.1:56379:6379 redis:7-alpine
docker run -d --rm --name owt-p5-s3 -p 127.0.0.1:59000:9000 -e RUSTFS_VOLUMES=/data -e RUSTFS_ADDRESS=0.0.0.0:9000 -e RUSTFS_CONSOLE_ENABLE=false -e RUSTFS_ACCESS_KEY=p5smoke -e RUSTFS_SECRET_KEY=p5smoke-local-only rustfs/rustfs:latest
```

The S3 container is `rustfs/rustfs` (the S3-compatible store the repository already ships in
`docker-compose.backup.yml`): the `minio/minio` image named in the original plan is no longer pullable from Docker
Hub. Any S3-compatible endpoint works; only the `P5_SMOKE_S3_*` values change. The fixture waits for the dependencies
itself; do not add manual sleeps. From `backend/`:

```bash
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55432 POSTGRES_DB=anak_test POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \
P5_SMOKE_RABBITMQ_URL=amqp://p5smoke:p5smoke-local-only@127.0.0.1:55672 \
P5_SMOKE_RABBITMQ_MANAGEMENT_URL=http://127.0.0.1:55673 \
P5_SMOKE_REDIS_URL=redis://127.0.0.1:56379/0 \
P5_SMOKE_S3_ENDPOINT_URL=http://127.0.0.1:59000 P5_SMOKE_S3_ACCESS_KEY=p5smoke P5_SMOKE_S3_SECRET_KEY=p5smoke-local-only \
RUN_P5_LIVE_SMOKE=1 uv run pytest stats-service/tests/test_ingest_live_smoke.py -v -s -p no:cacheprovider
```

When it is done and the fixture has stopped its processes, remove only what this session created:
`docker stop owt-p5-rabbit owt-p5-redis owt-p5-s3`; keep the shared test PostgreSQL. No production compose up/down, remote
URL or real workspace key belongs in this recipe.

What the run exercises (and asserts on native rows, the outbox and the journal, not on HTTP success): malformed JSON,
unsupported media, the 25 MiB cap (declared and streamed), missing/revoked/foreign/no-scope keys and a session token;
an unbound document parked as `awaiting_link` with zero observations and then explicitly bound by an administrator; a
three-team document in a shuffled order; eight concurrent identical posts; atomic replacement by a new document;
`409 idempotency_conflict` for changed content under an existing external id; forged hints; unknown stat and role
diagnostics; two registered disciplines served by separate workers with a wrong-queue delivery refused to the DLQ;
`logs_official` off, on and the administrator's result winning; a reparse that cannot override an accepted result; a
Workshop-format upload (the synthetic Task 0 fixture, not a real log) compared bit-for-bit with the Task 0 reference; a tournament replay through the `.replay` queue; a worker
frozen mid-job (the RPC process keeps answering) whose reclaimed attempt cannot commit when it wakes; and a hard-killed
worker whose claim is reclaimed after a restart. **It is local evidence only: not a timed production migration, not a
remote rehearsal and not permission to drop an old schema.** Windows note: the process tree of a venv launcher is
paused and killed as a unit by the fixture.
