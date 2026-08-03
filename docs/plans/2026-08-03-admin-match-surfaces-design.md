# Admin match surfaces + encounter result consolidation — Design

**Date:** 2026-08-03
**Status:** Design approved (brainstorming complete) — ready for implementation plan
**Process:** facilitated via `superpowers/brainstorming`
**Implementation plan:** `docs/plans/2026-08-03-admin-match-surfaces-plan.md`

> Related docs:
> - `docs/plans/2026-07-18-encounter-captain-reports-rework.md` — the captain report flow this builds on
> - `docs/plans/admin-balancer-ux-redesign.md` — v3.1 IA, tab tree, §6 pattern set (house style)
> - `docs/plans/admin-balancer-ux-inventory.md` — as-is admin audit
> - `docs/plans/encounter-best-of.md` — per-round best-of, drives series-score validity
> - `docs/design-book.md` — «Editorial Tactical», §5 `Encounter ⊃ Matches`

---

## 1. Understanding Summary

**What.** Two new admin entities, each surfaced in two places:

- **Match reports** — one row = an encounter plus its pair of captain reports (`home | away`).
- **Parsed matches** — one row = `matches.match`, i.e. one played map produced by the log parser.

Primary home is the tournament hub (`/admin/tournaments/[id]/matches/*` sub-tabs); a cross-tournament slice lives in the «Data browser» nav group. One admin list endpoint per entity, with an optional `tournament_id`, serves both.

**Why.** Two concrete gaps:

1. `result_status = disputed` is a dead end. The 2026-07-18 rework introduced automatic disputes and explicitly deferred the admin surface (§10 Out of Scope). Today an admin sees a dispute only by opening one encounter at a time, and cannot resolve it atomically.
2. Log-parsed matches are invisible to admins. The only signal is `Encounter.has_logs: bool`, plus a log-ingestion console that shows what was uploaded but never what it produced.

**Who.** Workspace admins/owners and superusers. Gates: `match.read` (read), `match.update` (result resolution), `log.reprocess` (re-parse).

**Blocking prerequisite.** Encounter result finalization currently has **two competing mechanisms** that can drive the same encounter into a contradictory, unrepairable state. Building a screen that *displays* result status on top of that model would make the inconsistency a first-class, user-visible feature with no fix. Consolidation is therefore Phase 0, not follow-up work.

**Explicit non-goals.** Editing or deleting an individual captain report. Editing a parsed match's score/map/teams, or deleting a match. A full scoreboard inside the admin theme. A unified «log ↔ match» list with orphans on both sides. Dispute reasons or dispute chat. Translating the admin panel. Full de-duplication of the two Challonge sync implementations.

---

## 2. Current-State Findings

All verified against the tree at 2026-08-03.

### 2.1 Two confirmation mechanisms

**Mechanism A — the `result_status` state machine.** `_recompute_encounter_result` (`backend/tournament-service/src/services/encounter/captain.py:258`) and `admin_confirm_result` (same file, `:421`). Writes the complete column set (`home_score`, `away_score`, `status`, `result_status`, `closeness`, `submitted_by_id`, `confirmed_by_id`), enforces guards in both directions, and fires the full side-effect chain: `advance_winner` → veto-session sync → tournament recalc → `EncounterCompletedEvent` → Challonge auto-push.

**Mechanism B — status-only completion.** `update_encounter` (`backend/tournament-service/src/services/admin/encounter.py:212`), `bulk_update_encounters` (same file, `:377`), and Challonge import (`.../services/challonge/sync.py:1173-1195`, `:1311-1329`). Reaches `status = COMPLETED` and fires advancement, but writes **no** `result_status`, **no** `confirmed_by_id`, **no** `submitted_by_id`, and respects **no** `result_status` guard.

Mechanism B cannot be corrected through any API: `result_status` is absent from `EncounterUpdate` (`backend/tournament-service/src/schemas/admin/encounter.py:34-51`), from `BulkEncounterUpdate` (`:69`), and from `EncounterUpdateInput` (`frontend/src/types/admin.types.ts:431-444`).

**Mechanism C — dead.** The entire pre-`EncounterCaptainReport` single-slot flow survives in parser-service: `src/services/encounter/captain.py` (single-slot submit, `confirm_captain_report` requiring the *other* captain, `closeness = stars/5` vs the live `/10`), `src/services/admin/encounter.py` (duplicate admin edit + bulk), `src/services/encounter/service.py:445` (`update_encounter_result`, zero callers). No parser RPC subject references any of it; the only importers are `parser-service/tests/test_captain_match_report.py:39`, `tests/test_encounter_write_locks.py:30`, `tests/test_bulk_encounter_update.py:39`.

### 2.2 What the divergence breaks today

| # | Defect | Evidence |
|---|---|---|
| F1 | Reachable contradictory state `status=completed` + `result_status=disputed`, repairable by no endpoint | B writes `status` without `result_status`; no schema exposes `result_status` |
| F2 | ~~Consumers disagree on «done»~~ — **corrected during T6**: no divergence exists. Three call sites each ask the question with their own `status==COMPLETED` **OR** `result_status==CONFIRMED`; all three agree today, but nothing keeps them phrased alike, and the pre-`encres0001` `completed`+`disputed` state made the phrasing load-bearing | `shared/services/tournament_utils.py:28-40`, `tournament-service/src/services/standings/service.py:126-129`, `parser-service/src/services/match_logs/flows.py:47-51` — all OR. The originally reported AND at `standings/service.py:127-128` was not there |
| F3 | Two `finalize_encounter_score` implementations; the parser copy lacks the elimination draw guard and the veto sync | canonical `tournament-service/src/services/encounter/finalize.py:31-88` (guard `:55-64`, veto sync `:83-84`) vs `parser-service/src/services/encounter/finalize.py:24-63` |
| F4 | Challonge import never emits `EncounterCompletedEvent` → imported results skip achievement/MVP recalculation, hand-entered ones do not | `sync.py:1382` fires recalc `:1634` + `tournament_changed` `:1642`, never `enqueue_encounter_completed`; consumer at `parser-service/serve.py:307-311` |
| F5 | The provenance columns `submitted_by_id`, `submitted_at`, `confirmed_by_id` have **zero live readers** anywhere in the tree, and `confirm-result` does not even write `confirmed_by_id` | `captain.py:460-469` omits it, so `finalize.py:73` sets only `confirmed_at`. Grep across `backend/`, `frontend/src`, `gateway/`: the only reader that ever existed is the dead Mechanism C guard at `parser-service/src/services/encounter/captain.py:131`; every frontend occurrence is a `null` in a test fixture. `submitted_by_id`/`submitted_at` are additionally a lossy projection of `EncounterCaptainReport.reporter_user_id` + timestamps since `captrep0001` — `_recompute_encounter_result` overwrites them with «whoever reported last» (`captain.py:274`, `:289`), which is not a meaningful concept |
| F6 | Bracket cascade reset leaves stale `closeness` | `shared/services/bracket/advancement.py:175-182` clears 8 columns; the word `closeness` does not appear in the file. `tournament/service.py:164-168` averages it into tournament closeness |
| F7 | `update_encounter` re-finalizes on **every** PATCH of a completed encounter (post-state test, not a transition test) → duplicate advancement + duplicate `EncounterCompletedEvent`. `bulk_update_encounters` is correctly transition-gated — the two disagree | `admin/encounter.py:286` vs `:438` |
| F8 | `PATCH /api/v1/admin/encounters/bulk` has zero frontend callers | `admin.service.ts:1342` `bulkUpdateEncounters`; grep of `frontend/src` finds no caller |
| F9 | Challonge conflict guard keys on `was_completed` only, so it silently overwrites a `pending_confirmation`/`disputed` local, destroying the dispute | `sync.py:1128`, `:1144-1166` |
| F10 | `disputed` is a dead end — exit only via force-confirm or an implicit bracket cascade. No reopen/reject endpoint exists | state table, §2.5 |
| F11 | `create_encounter` accepts `status=completed` with scores and calls no finalize → completed encounter that never advances the bracket | `admin/encounter.py:184-201` |
| F12 | `EncounterStatus.PENDING` is written by no finalization path — reachable only by typing it into a PATCH | `shared/core/enums.py:309-312` |

### 2.3 Match ⇄ log linkage

The domain rule «a match cannot exist without a log» holds **at the write path**:

- `matches.match` has exactly one production instantiation: `backend/parser-service/src/services/encounter/service.py:487` (`create_match`), reached from exactly one live caller, `match_logs/flows.py:968`. A second wrapper at `parser-service/src/services/encounter/flows.py:232` has zero callers.
- `set_processing` creates-or-reuses the `LogProcessingRecord` and **commits** (`match_logs/log_records.py:119`) before the processor is constructed, so the record always exists first.
- Challonge sync creates Encounters only (`sync.py:1111`); its `matches_created/updated/skipped` counters count encounters. `scripts/csv_to_import_json.py` writes no DB rows.

The **linkage** does not hold. There is no FK, no `match_id` column, no relationship:

- `match.log_name`: `Mapped[str] = mapped_column()` (`shared/models/matches/match.py:30`) — NOT NULL, **not unique, not indexed**. Always a basename: `filename.split("/")[-1]` (`match_logs/flows.py:1287`).
- `record.filename`: `String(500)`, NOT NULL, not unique, not indexed (`shared/models/ingestion/log_processing.py:49`). Stored **verbatim**.
- The tournament sweep feeds full S3 keys, because `s3.list_objects` returns `obj["Key"]` (`parser-service/src/services/s3/service.py:11-12` → `shared/clients/s3/client.py:143`). So the same log yields `record.filename = "logs/42/m.txt"` and `log_name = "m.txt"`. The upload path (`match_logs/uploads.py:19-20` rejects `/`, `\`, `..`) is the only one where they agree.
- `binary.py:152` defends with `(log_name or "").rsplit("/", 1)[-1]` — the code already does not trust `log_name` to be a bare name.

Six cases where the owning record cannot be resolved: 1:N duplicate records (`log_records.py:52-60` reuses only `pending`/`failed`); normalisation mismatch; `update_match` rewriting `log_name` to any string with zero validation (`admin/encounter.py:347-348`); empty/synthetic `log_name`; record present but the S3 object deleted by the parser itself on validation failure (`match_logs/flows.py:228`, `:328`) making retry permanently fail `log_not_found`; and legacy rows predating the squashed baseline `a7634c02717d` (which creates both tables in one revision, so the current graph has no gap, but pre-squash history is not in the repo).

Retry semantics, for the record: `POST /api/v1/admin/logs/{id}/retry` never touches Match rows. The re-run upserts in place keyed on `(encounter_id, map_id)` and rebuilds only the child stat tables (`match_logs/flows.py:967-1012`) — duplication is structurally impossible.

### 2.4 API and frontend shape

- Backend services expose **no HTTP**. They are FastStream/RabbitMQ RPC workers; the entire REST surface is declared in the Go gateway as `[]edge.RouteSpec` tables. `gateway/cmd/gateway/main.go:344-356` hard-404s any unmatched `/api/v1/*` — a new route requires a gateway change, plus `apidocs/groups.go`, the service's `openapi_schemas.py`/`openapi_docs.py`, regeneration of `gateway/internal/openapi/schemas.json`, and (for a new table) `gateway/internal/edge/apiv1_guard_test.go`.
- There is **no** admin list endpoint for encounters: `backend/tournament-service/src/services/admin/registry.py:287` sets `actions=frozenset({"create","update","delete"})`. `/admin/encounters` reads the public `GET /api/v1/encounters`.
- There is **no** admin route for matches beyond `PATCH /api/v1/admin/encounters/matches/{match_id}`, and **no** admin route for reports at all. The only report route is the public `GET /api/v1/encounters/{id}/reports`, whose handler returns a hand-rolled dict from `serialize_captain_report` (`captain.py:186-190`) — no Pydantic model, no OpenAPI manifest entry.
- List envelope: `Paginated{page, per_page, total, results}` (`shared/core/pagination.py:42-46`). Not uniform — `LogHistoryResponse` returns `{items, total}` (`parser-service/src/schemas/admin/logs.py:51-53`) and `CrudDispatcher._list` returns bare arrays.
- Admin frontend: `AdminDataTable` owns react-query, debounced search, URL-synced `page`/`per_page`/`sort`/`dir`, manual pagination/sorting and the empty state. Nav registration is `admin-navigation.ts` (`adminNavigationGroups` + `adminRoutePermissions`); sidebar, command palette and breadcrumbs are derived. `admin-navigation.test.ts` asserts exact href arrays per group. The admin panel is deliberately untranslated English. `vitest.config.ts` uses an explicit allow-list of `include` globs, not a catch-all.

### 2.5 State machine as it stands

`EncounterResultStatus`: `none | pending_confirmation | confirmed | disputed` (`shared/core/enums.py:271-275`).
`EncounterStatus`: `open | pending | completed` (`:309-312`).

| Path | `result_status` | `status` | Guard |
|---|---|---|---|
| First captain report | `none`/`disputed` → `pending_confirmation` | unchanged | rejects if `confirmed` (`captain.py:367`) |
| Second report, agree | → `confirmed` | → `completed` | same |
| Second report, disagree | → `disputed` | unchanged | same |
| `POST .../confirm-result` | `pending_confirmation`/`disputed` → `confirmed` | → `completed` | rejects any other (`captain.py:433-440`) |
| Admin PATCH / bulk PATCH | **untouched** | any → any | **none** |
| Challonge import | **untouched** | any → `open`/`completed` | `was_completed` only |
| Bracket cascade reset | any → `none` | any → `open` | fires when a team slot changed |

---

## 3. Assumptions and Non-Functional Requirements

Numbered so the plan and review can reference them. Docker was not running during design, so no production figures were measured; every quantity below is an assumption.

1. **[ASSUMPTION] Scale.** Order 10³–10⁴ encounters and 10⁴–10⁵ `matches.match` rows per installation; at most 2 reports per encounter. Server-side pagination with `per_page ≤ 100` is sufficient; the `getAll`-into-memory pattern of `/admin/encounters` is not copied.
2. **[ASSUMPTION] Latency.** p95 for either new list < 400 ms. Filter-chip counts come from a server aggregate, never from client-side reduction over a page.
3. **Per-row cost.** No per-row `COUNT(*)` over `matches.statistics` / `kill_feed` / `assists`. Those tables are documented as hot and high-volume (≈172 MB of indexes each); counts appear only in the single-row detail endpoint.
4. **[ASSUMPTION] Freshness.** No realtime requirement for the new lists: refetch on window focus plus invalidation after mutations. The Logs sub-tab keeps its existing `workspace:{id}:logs` subscription and its poll-while-queue-active behaviour.
5. **Security.** Both lists are workspace-scoped through the existing gates, so hidden-tournament visibility needs no separate check. Reads require `match.read` on the resolved workspace; result resolution requires `match.update`; re-parse requires `log.reprocess`.
6. **Migration safety.** The backfill must be idempotent and must have a working downgrade. The new CHECK constraint is added only after the backfill in the same revision, and the revision fails loudly rather than silently skipping rows it cannot classify.
7. **Maintenance.** No new design system: shadcn primitives plus `components/admin/tone.ts`. No new i18n namespace — the admin panel stays hardcoded English, matching every existing admin screen.
8. **Ownership.** Same team and conventions as the admin-balancer-ux work; §6 of that design is binding (row-click = detail, `…` menu = actions, `AlertDialog` for destructive, `Sheet` = quick-edit, server pagination, typed service layer).

---

## 4. Alternatives Considered

**A1 — Ship the screens first, consolidate later.** Rejected. The reports screen exists to make `result_status` actionable; on today's model it would faithfully render `completed + disputed` rows that no endpoint can repair, and the resolution button would be a two-call, non-atomic sequence (`PATCH` score, then `POST` confirm) racing the bracket cascade.

**A2 — Consolidate everything except Challonge import.** Rejected by the product owner. It removes the largest regression risk but leaves F4 (missing `EncounterCompletedEvent`), F9 (dispute-destroying conflict guard) and F3 (two `finalize` copies) in place, i.e. two mechanisms still exist — just with a nicer name for the second.

**A3 — Keep both mechanisms, add `result_status` to `EncounterUpdate`.** Rejected. It makes the contradiction *repairable* but still *reachable*, and puts the burden of keeping two columns coherent on every caller forever. It also cannot fix F2, since consumers would still be free to pick either column.

**A4 — Resolve the log link heuristically at read time, no schema change.** Rejected by the product owner. Zero migration cost, but every lookup scans two unindexed columns, ambiguity is permanent, and «re-parse» is offered on a guess.

**A5 — Make `match.log_record_id` NOT NULL.** Rejected. It cannot be validated without production data; any unmatched legacy row would either block the migration or force a synthetic placeholder record, which re-introduces the very ambiguity the FK removes.

**A6 — Reports list keyed on the individual report.** Rejected. The unit of action (confirm/resolve) is the encounter, and a dispute by definition spans two rows.

**A7 — Extend the existing log console instead of a parsed-matches list.** Rejected. Matches whose record was lost or was never resolvable would be invisible, which is precisely the diagnostic case the screen exists for.

---

## 5. Decision Log

| # | Decision | Alternatives | Why |
|---|---|---|---|
| D1 | Hub sub-tabs are the primary home; «Data browser» carries a cross-tournament slice of the same endpoint | hub-only; browser-only | Realises the approved v3.1 Phase-2 shape while preserving «show me every dispute» |
| D2 | Sub-tab state is a **path segment**: `/admin/tournaments/[id]/matches/{results\|reports\|maps\|logs}` | `?sub=` query param | Consistent with the hub's existing per-tab route segments and with D2 of the admin-balancer design (URL, never `useState`) |
| D3 | `/admin/tournaments/[id]/matches` redirects to `.../matches/results`; `/admin/tournaments/[id]/logs` permanently redirects to `.../matches/logs` | keep `logs` as a top-level tab | v3.1 §1.2 already retires `logs`; D28 requires redirects to carry mapped filters |
| D4 | Scope = read + dispute resolution + log re-parse | read-only; full moderation | Closes the `disputed` dead end with a bounded write surface |
| D5 | Parsed-matches row = one `matches.match` (a played map) | one log record; unified log↔match | Matches the ask and the `Encounter ⊃ Matches` rule in the design book |
| D6 | Reports row = encounter + report pair in one row | one report per row; toggle between the two | Matches the granularity of the resolution action |
| D7 | Match detail = `Sheet` with a technical summary; no scoreboard | link to the public page; embed `MatchStatsSection` | The admin question is «did this log parse correctly», not «who fragged whom». `MatchStatsSection` is `--aqt-*`-themed and would need restyling |
| D8 | Response envelope = `Paginated{page, per_page, total, results}` | `{items,total}`; bare array | Majority convention and the only shape `PaginatedResponse` on the frontend matches |
| D9 | Cross-tournament lists are scoped to the current workspace only | superuser cross-workspace slice | `apiFetch` already injects `workspace_id`; a cross-workspace mode is a separate feature |
| D10 | **Phase 0 = full consolidation before any UI** | screens first; consolidate all but Challonge | See A1/A2 |
| D11 | `result_status == CONFIRMED` **⟺** `status == COMPLETED`, enforced by a DB CHECK constraint | convention only; application-level assert | Makes the consolidation structural. The contradiction becomes unrepresentable, not merely discouraged |
| D12 | One low-level writer: `finalize_encounter_score` moves to `backend/shared/services/encounter/finalize.py`; the parser copy is deleted | keep two copies in sync | `shared/services/` already hosts `bracket/advancement.py`; a single copy is the only way F3 stays fixed |
| D13 | The shared `finalize_encounter_score` takes an optional `post_advance` async hook; tournament-service passes `sync_veto_session_after_team_change` | move `veto_session.py` to shared | `veto_session.py` pulls in service-local realtime registration; a hook is the minimal seam. Full de-duplication of Challonge sync stays out of scope |
| D14 | One atomic admin write: `POST /api/v1/admin/encounters/{id}/result`, replacing `confirm-result` | extend `confirm-result` with an optional body; two-call flow | «Resolve dispute by adopting side X» must be one transaction. Clean cutover — `confirm-result` is removed, not aliased |
| D15 | `POST /api/v1/admin/encounters/{id}/result/reopen` un-finalizes an encounter | leave `disputed` exit-only via force-confirm | Closes F10; also the only way to correct an operator error after D11 forbids ad-hoc status edits |
| D16 | `EncounterUpdate.status` no longer accepts `completed`; the transition is 409 with a pointer to the result endpoint. `create_encounter` likewise rejects `status=completed` | allow it and finalize internally | Keeps «edit metadata» and «finalize a result» as distinct, separately auditable operations; fixes F7 and F11 by construction |
| D17 | `PATCH /api/v1/admin/encounters/bulk` and `bulkUpdateEncounters` are deleted | keep as an admin escape hatch | Zero callers (F8); a second unguarded status writer is exactly what D11 forbids |
| D18 | Challonge import writes `result_status=CONFIRMED` + `confirmed_at`, emits `EncounterCompletedEvent`, and appends an audit row with `action=import`, `actor_user_id=NULL`; its conflict guard consults `result_status` | keep import as a privileged bypass | Fixes F4 and F9. The audit row's NULL actor is the durable marker of a machine confirmation |
| D19 | `_reset_stale_result` also clears `closeness` | leave as-is | Fixes F6 |
| D20 | All three call sites collapse to `status == COMPLETED` as the single form | `result_status == CONFIRMED`; keep the OR | Equivalent once D11's constraint holds, so the choice is about which column the codebase already speaks: `status` is what the other ~15 predicates, every production-derived test fixture, and `advance_winner` use. Choosing `result_status` would have forced a rewrite of large fixture datasets for no behavioural gain |
| D21 | Mechanism C is deleted outright, with its three tests | leave dead code | It is a working implementation of a superseded contract, which is worse than no code |
| D22 | New FK `matches.match.log_record_id` → `log_processing.record.id`, nullable, indexed, `ON DELETE SET NULL`, with a `(tournament_id, basename)` backfill | heuristic at read time; NOT NULL | See A4/A5 |
| D23 | `LogProcessingRecord.filename` is normalised to a basename on write; the S3 sweep strips the key prefix before dispatch | normalise on read everywhere | Removes the drift at the source instead of paying for it at every join |
| D24 | `log_name` is removed from `MatchUpdate` | keep it editable | With D22 the provenance is the FK; a freely editable `log_name` would re-introduce case 3 of §2.3 |
| D25 | Re-parse from a match row reuses `POST /api/v1/admin/logs/{id}/retry`, disabled when `log_record_id IS NULL` | new per-match reparse endpoint | The record is the unit of parsing; a per-match endpoint would need to invent one |
| D26 | The reports list gets a real Pydantic response model, and the public `GET /encounters/{id}/reports` is migrated to it | admin-only schema | One serialisation for one concept; also closes the OpenAPI gap for the public route |
| D27 | The row shows a `series_score_valid` flag derived from `Encounter.best_of` | validate on submit | Reports predate per-round best-of; flagging is honest, rejecting retroactively is not |
| D28 | Provenance shown in the Sheet is the FK; when it is NULL the Sheet says so explicitly and the retry action is disabled | hide the section | The design book forbids presenting an unknown as a value |
| D29 | Drop `submitted_by_id` and `submitted_at` from `tournament.encounter` | keep them in sync with the reports table | Strictly dominated by `EncounterCaptainReport.reporter_user_id` + `created_at`/`updated_at`, which record it per side instead of per last-writer. Their only consumer was the one-time `captrep0001` backfill (F5) |
| D30 | Drop `confirmed_by_id`; record result changes in a new `tournament.encounter_result_audit` table instead | fill `confirmed_by_id` on every path; drop it with no replacement | D15 makes the result a *mutable* state: a single slot remembers only the last confirmation and silently forgets reopens. Force-confirming a disputed result over a captain's objection is exactly the class of exceptional mutation this codebase already audits with a dedicated table (`balancer.draft_audit_event`, `players.user_merge_audit`) — there is no generic audit log to fall back on |
| D31 | `confirmed_at` stays on the encounter | derive it from the audit table | It is the only timestamp an admin confirmation with zero reports leaves, and lists sort and filter on it without joining the audit |

---

## 6. Data Model

### 6.1 New column

`matches.match`

| Column | Type | Notes |
|---|---|---|
| `log_record_id` | `Integer NULL`, FK → `log_processing.record.id` `ON DELETE SET NULL`, indexed | Resolved provenance. NULL = unresolvable legacy or detached row (D22) |

`Match.log_record` relationship, `lazy="raise"` by default and eager-loaded only where the admin surfaces need it.

### 6.2 New constraint

`tournament.encounter`

```
CHECK (
  (result_status = 'confirmed') = (status = 'completed')
)  -- ck_encounter_result_status_matches_status
```

Added after the backfill (D11). Note `encounterstatus` stores the **member name** (`COMPLETED`), not `.value` — the constraint expression must match the stored form; the migration asserts this against `pg_enum` before creating the constraint.

### 6.3 New table — `tournament.encounter_result_audit` (D30)

One row per transition of an encounter's result. Append-only; never updated, never deleted except by the encounter's `ON DELETE CASCADE`.

| Column | Type | Notes |
|---|---|---|
| `encounter_id` | `Integer NOT NULL`, FK → `tournament.encounter.id` `ON DELETE CASCADE`, indexed | |
| `actor_user_id` | `Integer NULL`, FK → `players.user.id` `ON DELETE SET NULL` | NULL = machine actor (Challonge import, bracket cascade) |
| `action` | `Enum(EncounterResultAuditAction)` — `confirm \| reopen \| auto_confirm \| auto_dispute \| import \| cascade_reset` | |
| `from_result_status` / `to_result_status` | `Enum(EncounterResultStatus) NULL` / `NOT NULL` | |
| `home_score_before` / `away_score_before` | `Integer NULL` | NULL when the encounter had no score |
| `home_score_after` / `away_score_after` | `Integer NOT NULL` | |
| `adopted_team_id` | `Integer NULL`, FK → `tournament.team.id` `ON DELETE SET NULL` | Which side's report was taken as truth, when applicable |
| `source` | `String(16)` | Mirrors `FinalizeSource`: `captain \| admin \| challonge \| log` |
| `created_at` | inherited from `TimeStampIntegerMixin` | |

Index `(encounter_id, created_at DESC)` — every read is «the history of this encounter», newest first.

### 6.4 Dropped columns (D29, D30)

`tournament.encounter`: `submitted_by_id`, `submitted_at`, `confirmed_by_id`, plus the `submitted_by` / `confirmed_by` relationships and the two FK constraints from `u1p5q9r0s1t2`. `confirmed_at` is kept (D31).

This removes them from `EncounterRead` in both services, from the frontend `Encounter` type (`encounter.types.ts:40-42`), and from the OpenAPI manifest. It is a breaking read-schema change; the house norm is a clean cutover, and no consumer reads them (F5).

### 6.5 Unchanged

`EncounterCaptainReport` / `EncounterMapCode` are untouched. They are, however, **absent from `docs/database_erd.md`** — the ERD documents `MATCH`, `LOG_RECORD` and `ENCOUNTER` but has no entity block for the report tables, and the changelog names the shipped table `encounter_report` while the design doc named it `encounter_captain_report`. Closing that documentation gap is part of this work.

`ENCOUNTER_SAVED_VIEW` (`workspace + auth_user + name → filters_json`) already exists and is reusable for saved admin filters; not used in this phase.

---

## 7. Service Logic

### 7.1 `finalize_encounter_score` (shared)

Moves verbatim to `backend/shared/services/encounter/finalize.py`, with one added parameter:

```python
async def finalize_encounter_score(
    session, encounter_id, *,
    home_score, away_score, source,
    encounter=None,
    status=EncounterStatus.COMPLETED,
    result_status=None,
    confirmed_at=None,
    post_advance: Callable[[AsyncSession, Encounter], Awaitable[None]] | None = None,
) -> FinalizedEncounterScore
```

Behaviour preserved: caller owns commit/publish; elimination draw guard; `advance_winner`; returns the advanced set. `post_advance` runs per advanced encounter and receives the veto sync in tournament-service. The vestigial `del source` is replaced by an actual use — `source` is recorded on the emitted event.

`backend/parser-service/src/services/encounter/finalize.py` is deleted; parser-service imports the shared one and passes `post_advance=None` **only** where it provably has no veto responsibility; the Challonge import path passes the sync (D13).

### 7.2 `set_encounter_result` (the single admin write)

Replaces `admin_confirm_result`. Steps:

1. Load the encounter `FOR UPDATE` with `captain_reports` + `map_codes`.
2. Resolve the score, in order:
   a. explicit `home_score`/`away_score` in the body;
   b. `adopt_report_team_id` → that team's report score;
   c. both reports present and agreeing → their score;
   d. the encounter's current score, if not `0-0`.
   None applicable → `422 result_score_unresolved`.
3. Resolve `closeness`, in order: explicit body value (1..10) → mean of present reports → keep current.
4. `finalize_encounter_score(..., status=COMPLETED, result_status=CONFIRMED, confirmed_at=now, source="admin")`.
5. Append one `EncounterResultAudit` row: `action=confirm`, the before/after scores and statuses, `adopted_team_id` when branch (b) was taken, `actor_user_id` = the acting admin.
6. Enqueue tournament recalculation and `EncounterCompletedEvent`; commit; Challonge auto-push when linked.

Guard widened relative to `admin_confirm_result` (which rejects `result_status = none`, `captain.py:433-440`): every non-`confirmed` value is accepted, since after the backfill `none` is the normal state of an unplayed encounter. Re-issuing against an already-`confirmed` encounter is a `409` — reopen first (D15).

### 7.3 `reopen_encounter_result`

`confirmed | disputed | pending_confirmation` → `result_status = none`, `status = open`, scores zeroed, `closeness = None`, `confirmed_at = None`, then the same downstream cascade `_reset_stale_result` performs, recursing where the previous result had advanced. Appends an audit row with `action=reopen`. Captain reports are **kept** — reopening is an admin correction, not a data purge, and the captains' submissions remain the evidence. Emits tournament recalculation. `409` when `result_status = none` already.

### 7.4 `_recompute_encounter_result`

Unchanged in behaviour, but its `confirmed` branch now routes through the shared finalize with the same argument set as §7.2, so captain auto-confirm and admin resolution are literally the same write. It appends an audit row with `action=auto_confirm` (`actor_user_id` = the second reporting captain) or `auto_dispute`. `_reset_stale_result` appends `cascade_reset` with `actor_user_id=NULL`; the Challonge importer appends `import`.

### 7.5 Challonge import

`_upsert_encounter_from_challonge` gains `result_status=CONFIRMED` and `confirmed_at=now`, the import job calls `enqueue_encounter_completed` for every encounter that transitioned into completed, and each such transition appends an audit row (`action=import`, `actor_user_id=NULL`, `source='challonge'`). The conflict guard's predicate changes from `was_completed` to `was_completed or result_status in (CONFIRMED, DISPUTED, PENDING_CONFIRMATION)`; a conflicting remote score against a local `CONFIRMED` is recorded in the sync log and skipped rather than overwritten.

### 7.6 Parser: log record linkage

- `s3_service.get_logs_by_tournament` returns basenames (strips the `logs/{tid}/` prefix) so the sweep and the upload path agree (D23).
- `set_processing` / `upsert_log_record` normalise `filename` to a basename before persisting.
- `MatchLogProcessor.start` sets `match.log_record_id` on both the create and the update branch, from the record resolved in `process_match_log`.

### 7.7 Admin list queries

**Reports list.** Base query over `Encounter`, filtered by workspace via `Tournament.workspace_id`, `selectinload(captain_reports → map_codes)`, `home_team`/`away_team`/`tournament`/`stage_item`. Derived per row: `reported_count`, `scores_match` (`None` when fewer than two reports), `series_score_valid` from `best_of`, and `last_resolution` — the newest `EncounterResultAudit` row for the encounter (`action`, `actor_user_id`, `actor_name`, `created_at`), or `None` when the audit is empty. `last_resolution` is fetched with a single window-function subquery (`ROW_NUMBER() OVER (PARTITION BY encounter_id ORDER BY created_at DESC)`), not N+1. Filters: `tournament_id`, `stage_id`, `result_status[]`, `mismatch_only`, `reported_count`, free-text over team and encounter names. Default sort: `updated_at desc`.

**Matches list.** Base query over `Match`, joined to `Encounter → Tournament` for workspace scoping, `selectinload(map, home_team, away_team, encounter, log_record)`. Filters: `tournament_id`, `encounter_id`, `map_id`, `log_status[]` (from the joined record), `unlinked_only` (`log_record_id IS NULL`), free text over `log_name`/`code`/team names. Default sort: `created_at desc`. No stat counts (NFR 3).

**Detail.** `GET /api/v1/admin/matches/{id}` adds `rounds` and the three stat counts, each a single `COUNT(*)` on an indexed `match_id`.

---

## 8. API / RPC / Gateway

### New

| Method | Path | RPC subject | Gate | Response |
|---|---|---|---|---|
| POST | `/api/v1/admin/encounters/{encounter_id}/result` | `rpc.tournament.encounter_set_result` | `match.update` | `EncounterResultRead` |
| POST | `/api/v1/admin/encounters/{encounter_id}/result/reopen` | `rpc.tournament.encounter_reopen_result` | `match.update` | `EncounterResultRead` |
| GET | `/api/v1/admin/encounter-reports` | `rpc.tournament.admin_encounter_reports_list` | `match.read` | `Paginated[EncounterReportsRow]` |
| GET | `/api/v1/admin/encounter-reports/stats` | `rpc.tournament.admin_encounter_reports_stats` | `match.read` | `EncounterReportsStats` |
| GET | `/api/v1/admin/matches` | `rpc.tournament.admin_matches_list` | `match.read` | `Paginated[AdminMatchRow]` |
| GET | `/api/v1/admin/matches/{match_id}` | `rpc.tournament.admin_match_get` | `match.read` | `AdminMatchDetail` |
| GET | `/api/v1/admin/encounters/{encounter_id}/result-audit` | `rpc.tournament.encounter_result_audit` | `match.read` | `list[EncounterResultAuditRead]` |

All seven are `edge.AuthRequired`, added to `gateway/internal/tournament/admin_misc_routes.go` (an existing table, so `main.go` needs no new `Register` call), with `AllQuery: true` on the two lists. Literal-before-`{param}` ordering matters: `/api/v1/admin/matches` must precede any future `/api/v1/admin/matches/{...}` catch-all in the same table.

### Removed (clean cutover)

- `POST /api/v1/admin/encounters/{encounter_id}/confirm-result` → superseded by `.../result` (D14).
- `PATCH /api/v1/admin/encounters/bulk` + `rpc.tournament.encounter_bulk_update` (D17).
- Mechanism C modules and their tests (D21).
- `parser-service/src/services/encounter/finalize.py` (D12), `.../encounter/flows.py:232 create_match` (dead), `.../encounter/service.py:445 update_encounter_result` (dead).

### Changed

- `EncounterUpdate.status`: `completed` rejected with `409 use_result_endpoint` (D16). `EncounterCreate` likewise.
- `MatchUpdate`: `log_name` removed (D24).
- `rpc.tournament.captain_reports` gains a typed response (`list[CaptainReportRead]`) and a manifest entry (D26).
- `EncounterRead` (both services) loses `submitted_by_id`, `submitted_at`, `confirmed_by_id` (D29, D30).

### New schemas

`CaptainReportRead`, `EncounterMapCodeRead`, `EncounterReportsRow`, `EncounterReportsStats`, `EncounterResultRead`, `EncounterSetResultInput`, `EncounterResultAuditRead`, `AdminMatchRow`, `AdminMatchDetail`, `LogRecordRef`.

Each new subject needs an entry in `backend/tournament-service/src/openapi_schemas.py` + `openapi_docs.py`, a group assignment in `gateway/internal/apidocs/groups.go` (`Admin: Tournaments`), and a regenerated `gateway/internal/openapi/schemas.json`. A missing manifest entry degrades silently to a generic `object`, so this is verified, not assumed.

---

## 9. Migration + Backfill

Two revisions, applied in order.

**`encres0001` — result consolidation.**

1. Create `tournament.encounter_result_audit` and its enum type.
2. `UPDATE tournament.encounter SET result_status='CONFIRMED', confirmed_at=COALESCE(confirmed_at, updated_at, created_at) WHERE status='COMPLETED' AND result_status <> 'CONFIRMED';`
3. `UPDATE tournament.encounter SET status='COMPLETED' WHERE result_status='CONFIRMED' AND status <> 'COMPLETED';` — expected to affect zero rows; the count is logged.
4. `UPDATE tournament.encounter SET closeness=NULL WHERE result_status <> 'CONFIRMED' AND closeness IS NOT NULL;` — clears the F6 residue.
5. Seed the audit from the columns about to disappear: one `action='confirm'` row per encounter with a non-NULL `confirmed_by_id`, carrying `actor_user_id=confirmed_by_id`, `to_result_status='CONFIRMED'`, the current score as the after-score, `created_at=confirmed_at`, `source='captain'`. Everything else is unrecoverable and is simply not seeded — the audit starts empty for those encounters, which is honest.
6. Assert `SELECT count(*) FROM tournament.encounter WHERE (result_status='CONFIRMED') <> (status='COMPLETED')` is 0, then add `ck_encounter_result_status_matches_status`.
7. Drop `confirmed_by_id`, `submitted_by_id`, `submitted_at` and their two FK constraints (`fk_encounter_confirmed_by`, `fk_encounter_submitted_by`).

Downgrade re-adds the three columns as nullable and drops the constraint and the audit table; the data changes are not reverted, and the docstring says so.

**`mtchlog001` — match ⇄ log FK.**

1. Add `log_record_id` nullable + index.
2. `UPDATE matches.match m SET log_record_id = r.id FROM LATERAL (SELECT id FROM log_processing.record r WHERE r.tournament_id = (SELECT e.tournament_id FROM tournament.encounter e WHERE e.id = m.encounter_id) AND regexp_replace(r.filename, '^.*/', '') = regexp_replace(m.log_name, '^.*/', '') ORDER BY (r.status='done') DESC, r.created_at DESC LIMIT 1) r;` — deterministic tiebreak: prefer `done`, then newest.
3. Add the FK constraint.
4. Normalise existing rows: `UPDATE log_processing.record SET filename = regexp_replace(filename, '^.*/', '') WHERE filename LIKE '%/%';` — run **after** the join, so the join can still see the original form.
5. Log the residual count of `log_record_id IS NULL` rows; do **not** fail. That number is the honest size of the un-resolvable legacy set (D22, A5).

Both revisions are idempotent by construction (all `UPDATE`s are guarded by the condition they establish).

---

## 10. Frontend

### 10.1 Routes

```
/admin/tournaments/[id]/matches            → redirect .../matches/results
/admin/tournaments/[id]/matches/results    → TournamentMatchesTab      (moved, unchanged)
/admin/tournaments/[id]/matches/reports    → TournamentReportsTab      (new)
/admin/tournaments/[id]/matches/maps       → TournamentParsedMatchesTab(new)
/admin/tournaments/[id]/matches/logs       → TournamentLogsTab         (moved)
/admin/tournaments/[id]/logs               → permanent redirect .../matches/logs
/admin/match-reports                       → cross-tournament reports  (new)
/admin/matches                             → cross-tournament matches  (new)
```

Each hub segment is the established thin shell: `"use client"`, `next/dynamic` import with `{ loading: () => tabFallback }`, shared hub queries, capabilities computed via `canAccessPermission(..., workspaceId)` and passed down as props. `tab-guards.ts` gains the sub-tab keys and an `allowedSubTab` predicate; unknown or unpermitted segments redirect to `.../matches/results`.

### 10.2 Files to touch for the two Data-browser entries

1. `frontend/src/app/admin/match-reports/page.tsx`, `frontend/src/app/admin/matches/page.tsx` — new.
2. `frontend/src/components/admin/admin-navigation.ts` — two items in the «Data browser» group (`permissions: ["match.read"]`, icons `ClipboardCheck` and `Map`), two entries in `adminRoutePermissions` placed **before** the `/admin/matches`-shadowing prefixes and after longer prefixes.
3. `frontend/src/components/admin/admin-navigation.test.ts` — the Data-browser href assertion (`:52-60`) and the uniqueness/alias assertions (`:108-121`).
4. `frontend/vitest.config.ts` — add `src/app/admin/matches/**/*.test.ts` and `src/app/admin/match-reports/**/*.test.ts` to `include`; the config is an explicit allow-list, so a new test file otherwise never runs.

Sidebar, command palette and breadcrumbs are derived from `admin-navigation.ts` and need no edits.

### 10.3 Components

- `AdminReportPairCell` — compact `home | away` report pair for a table row: score, closeness, reporter, timestamp, and a mismatch marker that is never colour-only (design book §accessibility floor).
- `ResolveResultDialog` — the single write surface. Radio choice of «adopt home report» / «adopt away report» / «enter manually», an optional closeness override, and a preview of the resulting score. Embeds the existing `CaptainReportsView` (already used by both `MatchReportDialog` and `EncounterEditDialog`) for the side-by-side evidence, and a collapsed **change history** fed by `.../result-audit` — empty for encounters predating this change, rendered as «no recorded changes» (R5b). Submits once, to `.../result`. For an already-`confirmed` encounter the primary action becomes **Reopen**, behind an `AlertDialog`.
- `ParsedMatchSheet` — technical summary: map, gamemode, duration, rounds; provenance block (log record id, status, source, uploader, timestamps, error) or an explicit «provenance unresolved» state; stat counts; download-log and re-parse actions.
- `MatchLogIndicator` is reused as-is in both new lists — it is explicitly documented as theme-agnostic — replacing the bespoke `FileCheck2`/`FileX2` pair on `/admin/encounters`.

### 10.4 Service and types

`adminService`: `+ setEncounterResult`, `+ reopenEncounterResult`, `+ getEncounterResultAudit`, `+ listEncounterReports`, `+ getEncounterReportStats`, `+ listAdminMatches`, `+ getAdminMatch`; `− confirmEncounterResult`, `− bulkUpdateEncounters`. `admin.types.ts` mirrors the seven new schemas; `MatchUpdateInput` loses `log_name`; `EncounterUpdateInput.status` narrows to `"OPEN" | "PENDING"`. The frontend `Encounter` type (`encounter.types.ts:40-42`) loses `submitted_by_id`, `submitted_at`, `confirmed_by_id`; the four test fixtures that set them to `null` are updated.

Callers of the removed methods that must be updated: `EncounterEditDialog.tsx:113,123`, `app/admin/encounters/page.tsx:207`, `TournamentMatchesTab.tsx:253`.

---

## 11. Realtime / Invalidation Contract

| Trigger | Invalidated |
|---|---|
| `setEncounterResult` | `["encounters"]`, `["encounter-reports"]`, `["admin-matches"]`, `invalidateTournamentWorkspace(tournamentId)`, `["standings", tournamentId]` |
| `reopenEncounterResult` | same as above, plus the bracket query for the tournament |
| `retryLogRecord` from a match row | `["admin-matches"]`, `["logs", workspaceId]` |
| existing `workspace:{id}:logs` topic | Logs sub-tab only, unchanged |

No new realtime topic. The reports and matches lists refetch on window focus and after the mutations above (NFR 4).

---

## 12. Error Handling and Edge Cases

- **Score unresolvable** (`422 result_score_unresolved`) — no explicit score, no report to adopt, and the encounter is `0-0`. The dialog keeps the manual-entry field focused.
- **Drawn score in an elimination stage** (`400`, existing guard) — surfaced verbatim; the dialog blocks submit for a draw when the stage is single/double elimination.
- **Already confirmed** (`409`) — the resolve action is hidden for `confirmed` rows; the guard is the server-side backstop against a stale page.
- **Concurrent captain submit during resolution** — the encounter is loaded `FOR UPDATE`; the later writer wins and the client refetches.
- **Match with `log_record_id IS NULL`** — the Sheet shows «provenance unresolved», re-parse is disabled with the reason, and the log-download button falls back to the existing `log_name`-based endpoint, which may itself 404.
- **Record present but the S3 object deleted** (`match_logs/flows.py:228`, `:328`) — retry returns `log_not_found`; the Sheet surfaces the record's stored `error_message` so the admin sees why the log is gone before clicking.
- **Ambiguous backfill** — the migration's deterministic tiebreak may attach the wrong duplicate record. Mitigated by the `done`-first ordering and by the fact that duplicates share a filename and tournament, so the shown provenance differs only in timestamps.
- **`series_score_valid = false`** — rendered as an advisory marker, never a blocker (D27).
- **Permission masking** — a user with `match.read` but not `match.update` sees the lists and the Sheet without any action; the tab is not hidden, since reading is the point.

---

## 13. Testing

**Backend (pytest, per touched service).**
- `finalize_encounter_score` moved to shared: elimination draw guard still raises; `post_advance` runs once per advanced encounter; parser path now hits both.
- `set_encounter_result`: each of the four score-resolution branches; `409` on already-confirmed; `422` when unresolvable; exactly one audit row with `action=confirm`, the acting admin as `actor_user_id`, correct before/after scores and `adopted_team_id`; exactly one `EncounterCompletedEvent`.
- `reopen_encounter_result`: clears the full column set including `closeness` and `confirmed_at`; appends an audit row with `action=reopen`; cascades downstream when the previous result had advanced; keeps captain reports; `409` on `none`.
- Audit rows are append-only: a confirm → reopen → confirm sequence leaves exactly three rows in chronological order, and the encounter's `ON DELETE CASCADE` removes them.
- `EncounterUpdate` rejecting `status=completed`; `create_encounter` likewise.
- Challonge import: emits `EncounterCompletedEvent`; refuses to overwrite a `CONFIRMED` local with a differing remote score and records a conflict.
- `_reset_stale_result` clears `closeness`.
- Migration `encres0001`: seeded contradictory rows are repaired and the constraint then holds; a deliberately unrepairable row makes the assert fail loudly.
- Migration `mtchlog001`: basename join across the bare/full-key drift; `done`-first tiebreak; residual NULLs counted, not fatal.
- Both list endpoints: workspace scoping (another workspace's rows never appear), each filter, `Paginated` envelope shape, `per_page` cap.
- Parser sets `log_record_id` on create and on the update branch.

**Frontend (vitest).**
- Pure helpers only, per house convention: series-score validity against `best_of`, report-pair derivation (`reported_count`, `scores_match`), sub-tab guard predicate, redirect mapping.
- `admin-navigation.test.ts` updated assertions.
- No component tests for the new tabs — the admin panel has none for comparable screens.

**Not written:** tests for the deleted Mechanism C (removed with it), and no new tests for `AdminDataTable`, which is already covered.

---

## 14. Verification and Acceptance Criteria

1. `SELECT count(*) FROM tournament.encounter WHERE (result_status='CONFIRMED') <> (status='COMPLETED')` returns 0, and inserting a violating row fails on the constraint.
2. Exactly one *implementation* of `finalize_encounter_score` exists, under `shared/services/encounter/`. `tournament-service/src/services/encounter/finalize.py` keeps the name as a thin binding wrapper whose only job is injecting the veto hook (D13), so `grep -rn "def finalize_encounter_score"` returns two hits by design — the wrapper delegates and holds no logic.
3. `grep -rn "confirm-result\|bulkUpdateEncounters\|encounter_bulk_update" backend/ frontend/ gateway/` returns nothing.
4. `gateway/internal/openapi/schemas.json` contains a `response` ref for all seven new subjects and for `rpc.tournament.captain_reports`.
5. Browser smoke, end to end:
   - `/admin/tournaments/{id}/matches` redirects to `.../results`; `/admin/tournaments/{id}/logs` redirects to `.../matches/logs`.
   - Reports sub-tab lists encounters with report pairs; the `Disputed` filter chip count matches the stats endpoint.
   - Resolving a dispute by adopting one side sets score, `status=completed` and `result_status=confirmed` in one request, records an audit row naming the acting admin and the adopted side, and the bracket advances and standings update.
   - Reopening that encounter returns it to `open`/`none` with the reports still visible.
   - Maps sub-tab lists parsed matches; the Sheet shows provenance for a linked match and «provenance unresolved» with a disabled re-parse for an unlinked one; re-parse on a linked match flips the record to `pending` and the list reflects the new status.
   - `/admin/match-reports` and `/admin/matches` show the same data across the workspace's tournaments and appear in Cmd+K.
6. A user with `match.read` and without `match.update` sees both lists and no write actions.
7. `docs/database_erd.md` and its mirror `frontend/src/app/docs/diagrams.ts` gain the `ENCOUNTER_CAPTAIN_REPORT` / `ENCOUNTER_MAP_CODE` blocks and the new `ENCOUNTER_RESULT_AUDIT` entity, lose `ENCOUNTER.submitted_by_id`/`confirmed_by_id`, and record the `MATCH.log_record_id` FK plus the new constraint.
8. `grep -rn "confirmed_by_id\|submitted_by_id\|submitted_at" backend/ frontend/src gateway/` returns only migrations (`encres0001` and the two historical revisions that created the columns), the parity test that asserts their absence, and the model comments explaining the removal.

### Phase 0 verification — recorded state (2026-08-03)

Passing: criteria 2, 3, 4 and 8; `ruff check .` clean; every backend suite green
(shared 336, tournament 564, parser 207, app 181, balancer 287, identity 143,
analytics 155, discord 12); `go build` + `go vet` + `go test ./...` green;
`tsc --noEmit` clean, vitest 232/232, eslint 0 errors.

**Not verified — no environment for it:**

- **Criterion 1 and both migrations are unapplied.** `encres0001` and
  `mtchlog001` have never run against a database. There is no local Postgres
  (nothing listening on 5432/15432/54320) and the only reachable DSN in
  `backend/.env` is a remote shared host — applying a revision that drops three
  columns there is not an option. The metadata tests
  (`test_encres0001_migration_matches_models.py`,
  `test_mtchlog001_migration_matches_models.py`) pin the DDL, the enum storage
  forms and the invariant expression, but **the backfills, the pre-constraint
  assertion and the FK join are unexercised**. Both must be applied to a scratch
  database before deploy; the opt-in pattern in
  `tournament-service/tests/test_check_in_gate_integration.py`
  (`SUBSCRIPTIONS_IT_DSN`) is the precedent for wiring that.
- **Criteria 5 and 6 (browser smoke, permission masking)** need a running stack.
  They also cover surfaces that Phases 1–2 have not built yet.

---

## 15. Risks and Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Elimination-stage draws that currently succeed through the parser's guard-less finalize start returning 400 | The guard was always the intended behaviour (F3). The migration logs pre-existing drawn elimination encounters so they can be corrected before rollout |
| R2 | The CHECK constraint blocks the migration on data nobody predicted | The revision asserts and fails **before** creating the constraint, with the offending row count in the message — a diagnosable failure, not a half-applied migration |
| R3 | Removing `status=completed` from `EncounterUpdate` breaks an operator workflow | The replacement is one click away in the same dialog, and the 409 names the endpoint. `EncounterEditDialog` already hosts both controls |
| R4 | Challonge conflict guard consulting `result_status` surfaces a wave of previously silent conflicts | Expected and desirable — they were silent overwrites. The sync log records each; the first import after rollout should be reviewed |
| R5 | Dropping three columns from `EncounterRead` breaks an undiscovered external consumer of the public encounter payload | Verified zero readers in this repo (F5); the fields are nullable and were always NULL for admin- and Challonge-confirmed encounters, so no consumer could have depended on them being populated. Called out in the ERD update |
| R5b | The audit is seeded only for encounters that had a non-NULL `confirmed_by_id`, so history before this change is mostly empty | Accepted and documented: the pre-existing data genuinely does not contain it. An empty history renders as «no recorded changes», never as «confirmed by nobody» |
| R6 | The FK backfill attaches the wrong record for duplicated filenames | Deterministic `done`-first, newest-next tiebreak; the Sheet shows the record id so a wrong attachment is visible and correctable |
| R7 | Two Challonge sync implementations remain | Explicitly out of scope and recorded as debt. Phase 0 removes the *finalization* divergence between them, which is the part that corrupts data |
| R8 | The parsed-matches list is slow on the largest workspace | Indexed FK, no per-row counts, server pagination. If p95 exceeds NFR 2, the fallback is a covering index on `(encounter_id, created_at)` |
| R9 | `/admin/encounters` and the new lists drift apart in columns | The cross-tournament matches list is the demoted Data-browser sibling; `/admin/encounters` keeps its own scope and both reuse `MatchLogIndicator` and the same status vocabulary |

---

## 16. Out of Scope (YAGNI)

- Editing or deleting an individual captain report.
- Editing a parsed match's score, map or teams beyond today's `PATCH`; deleting a match; re-attaching a log to a different encounter.
- A full scoreboard rendered inside the admin theme.
- A unified «log ↔ match» list showing orphans on both sides.
- Dispute reasons, dispute chat, dispute assignment.
- Cross-workspace superuser slices of either list.
- Saved filter views over the new lists (`ENCOUNTER_SAVED_VIEW` exists; wiring it is a later phase).
- De-duplicating the two Challonge sync implementations.
- Making `match.log_record_id` NOT NULL.
- Translating the admin panel.
