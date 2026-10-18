# Multi-game P6 achievements and analytics: release note and P9 conversion runbook

P6 makes the achievement engine and the analytics pipeline discipline-scoped. Rules, awards, overrides, rarity, models and
history are owned by one game and nothing reads, writes or evaluates across that line; Overwatch keeps its exact behaviour
inside its module. See the [architecture](../architecture.md), the [stats-service README](../../backend/stats-service/README.md#achievement-engine)
and the [analytics-service README](../../backend/analytics-service/README.md). **This note records local implementation
evidence. No production artifact was converted, no remote command was run and no legacy table was dropped; the real
inventory, conversion and rehearsal are a P9 operational gate.**

Deploy stats, app, gateway and frontend together: there is no old-wire compatibility.

## 1. What changed on the wire

* **Portable achievement format v2.** `schema_version: 2`, every rule carries `discipline` and `entity_id`. Version 1,
  a missing version and `hero_id` are explicit validation errors (a named message in the admin UI, no request sent for a
  v1 file); there is no alias, silent discard or auto-converter. A batch is validated whole before the first rule or image
  write; a missing, foreign or wrong-kind `entity_id` rejects the batch with the slug and the problem in the message.
  `min_tournament_id` names a tournament of the target workspace and the rule's game: a file import (no source workspace
  or the same workspace) rejects an unknown one; a library import from another workspace cannot translate it, so it drops
  the cutoff and reports a per-rule warning in the import result. Set the cutoff in the target workspace afterwards:
  until then the copied rule evaluates from the first tournament.
* **Discipline on every achievement API.** Create, seed/reset, condition metadata (`condition-types`), validate, evaluate,
  calculate, export, library list/import/workspaces and the overrides list name the discipline (body or `?discipline=`);
  a request without it is a 422. An existing rule's discipline is immutable (the update wire has no `discipline`), a slug
  held by another discipline's rule is a 409, and the discipline must be enabled for the workspace.
* **Public reads.** `GET /api/v1/achievements` pools, counts and divides rarity per `(discipline, slug)`; `?discipline=`
  narrows to one game. Rows carry `discipline`, `entity_id` and `entity`.
* **Organizer entity picker.** `GET /api/v1/admin/ws/{workspace_id}/catalog/{discipline}/character` (workspace
  `achievement.create`/`update`, game enabled for the workspace) replaces the superuser-only catalogue read.

## 2. Migration `achievement06` (forward-only)

`achievement06` (parent `ingest01`; the sole head) removes only the server default `'overwatch'` of
`achievements.rule.discipline` (the ORM default is gone too); the column stays `NOT NULL`, with the entity check and the
composite FK. It carries no data change. `downgrade()` raises: rollback after commit means restoring the verified backup
and the matching old images, never `alembic downgrade`.

## 3. Evaluation and analytics scoping

* The runner resolves the trigger's owner (tournament and/or match, verified against the workspace) before selecting
  rules: a tournament or match event evaluates only its discipline's rules; a workspace-wide trigger partitions by
  discipline; grids, normalizers and leaf caches are per discipline. A discipline with no conditions (LoL) is reported on
  the run and its stored results are untouched. `rule_ids=None` is unrestricted, `[]` selects nothing.
* Overwatch's 41 leaf queries gained the tournament-discipline predicate (a LoL roster used to feed Overwatch awards).
* Analytics resolves the module, the rated role ids and the declared algorithm from the tournament's discipline; history
  and cache keys carry the discipline; a foreign algorithm sharing a model kind is never loaded. **There is no LoL ML
  fallback**: LoL declares no analytics module, so it has no algorithm, no model and no prediction (`UnsupportedAnalytics`;
  runners return empty and write nothing).

## 4. Artifact conversion runbook (P9)

`PerformanceModelV2`, `_ConstantClassifier`, `WinProbabilityModel` and `ShiftModelV2` moved to
`shared.disciplines.overwatch.analytics.models.*` and the runtime keeps no old-path alias, so **every** referenced
artifact (active and historical) must be converted in a maintenance window with
`analytics-service/scripts/convert_discipline_artifacts.py`. Full steps and flags:
[`runbook-shift-recompute.md`](../../backend/analytics-service/docs/runbook-shift-recompute.md#artifact-class-conversion-model-move-to-shareddisciplinesoverwatch--maintenance-only).

1. **Prerequisites.** Retained OLD image (pre-move source and lockfile) and NEW image with identical pinned numerical
   libraries (`stage` refuses a difference); workers, training, scheduler and cache writers stopped; storage snapshot and
   free staging space; maintenance approval.
2. **Inventory** every `analytics.ml_model_artifact` row with its trusted original bytes and verification frames; nothing
   is skipped or retrained.
3. **Two-image procedure:** `export` in the old image (read-only model volume) → `stage` in the new image (immutable
   `discipline06/<id>/<old-sha256>.joblib`, reopened with the ordinary loader, state and every prediction bit-identical to
   the receipt) → review `receipt.json` → `apply` (one transaction, rows locked in id order, **only** `storage_uri`
   updated, current old URI required).
   `apply` also blocks, naming the ids, when a performance/shift/standings registry row outside the receipt still
   points at a non-converted URI (an incomplete inventory), and a missing or unloadable artifact makes the runners log and
   fall back to their neutral result.
4. **Exact allowlist.** The unpickler resolves only an audited exact `(module, name)` set plus the artifact's own legacy
   classes; dotted names and any other global are rejected before `REDUCE`, and nested pickles (object-dtype ndarray
   payloads included) get the same exact-global checks. An unlisted library global blocks the release until reviewed
   and added.
5. **Rollback.** `rollback --receipt` restores the original URI set (the old image is needed to read the old bytes);
   originals and converted files are never deleted. Originals' SHA256 and the new SHA256 are both recorded (they differ by
   design).
6. **P9 gate.** The real inventory shows no unsupported class or state, every referenced artifact in the receipt, a
   rehearsed apply + rollback, and reviewed checksums/predictions before the new image serves traffic. Fixture tests
   prove the tool, not any production artifact.

## 5. Verification actually run (local, 2026-10-18)

* **Live achievement smoke** (`backend/stats-service/tests/test_ingest_live_smoke.py`, `RUN_P5_LIVE_SMOKE=1`, P5's
  stack: real identity, tournament, stats RPC and two workers, RabbitMQ, Redis, S3, gateway): Overwatch ingest awards the
  three qualifying members once; the standings invalidation still reaches its original consumer; encounter completion and
  twice-redelivered events converge; awaiting-link and failed ingests award nothing; a LoL ingest evaluates only LoL's
  condition-less rule and leaves its sentinel award untouched. Recipe: the P5 release note, section 15.
* **Analytics runtime smoke** (`analytics-service/tests/test_discipline_runtime_smoke.py`): export under the archived
  pre-move source → stage → apply → registry/`run_for_tournament` as a non-owner role without legacy schema USAGE →
  frozen receipts reproduced bit-for-bit, written tables equal an independently assembled registry (the standings
  distribution included, compared exactly under a seeded test RNG) → LoL untouched → rollback.
* **Browser pass** (Next dev against the local stack, organizer who is not a superuser): game selection sends
  `discipline`; LoL shows the zero-condition state with a disabled *Add condition*; organizer entity picker lists only the
  game's characters; create/update payloads carry `discipline`/`entity_id` and never `hero_id` (update has no
  `discipline`); override options are per game and cross-game overrides are 422; v1 import is refused client-side;
  keyboard game switch, `Esc`, row navigation work. The pass found two defects, fixed here with tests: the public list
  returned 500 (`discipline` leaked into the pagination dataclass) and rule/import validation errors reached the UI as the
  bare word "error" (now named).

## 6. Deferred items and known limits

* P9: real artifact inventory/conversion, trusted original bytes, maintenance approval, rehearsal; image identity strings
  are recorded, not verified. Real-log decoder parity and the P4 data blockers are unchanged (P5 note, section 14).
* Read-side algorithm gating uses a globally selected declaration (`reads.py`); revisit when a second module declares
  analytics. `rpc.analytics.artifacts` stays a global admin listing.
* `tests/api/routes/test_achievements.py` has data-dependent failures equal to the P5 baseline; the public catalogue's
  art falls back to `/achievements/<slug>.webp` by slug only.
* Anonymous visitors see no game chips on the public catalogue (the workspace list is not loaded for them).
* The admin override user picker searches by `battle_tag`; users created only through native social accounts were not
  found in the local pass. The tournaments list answers 422 on seeded tournaments without dates (unrelated to P6).
* The PATCH of a tree whose grain disagrees with the inferred grain is refused (correct), now with the reason shown.
