# Division Grid Management Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. TDD is mandatory (superpowers:test-driven-development).

**Goal:** Replace the terrible admin division-grid management UX with a "one grid per workspace, versions hidden" model where a single Save auto-versions, auto-generates mappings (hybrid slug→rank-overlap→conflict), and auto-activates — without changing the runtime normalization contract used across the rest of the site.

**Architecture:** Add one server-authoritative orchestration endpoint (`grid_save`) that classifies cosmetic vs structural edits and does the whole flow atomically. Auto-mapping is a pure function feeding the existing validated `upsert_mapping`. Readiness is enriched with human-readable info + per-tier conflicts. The conflict resolver reuses existing mapping read/write + activate endpoints. Runtime reads (`build_workspace_division_grid_normalizer`, `getDivisionGridMapping`, standings) are untouched.

**Tech Stack:** FastAPI + faststream RPC (backend/tournament-service), SQLAlchemy 2.0 models (backend/shared), Alembic (backend/migrations), Go HTTP gateway (gateway/internal/tournament), Next.js + React Query + vitest (frontend).

---

## Invariants (MUST NOT break)

1. **Backend runtime normalizer** — `backend/shared/services/division_grid_access.py::build_workspace_division_grid_normalizer` consumes `DivisionGridMapping`/`DivisionGridMappingRule` by tier **id**, requires `is_complete` + weights summing to 1.0 per source tier + a primary rule for splits. Keep tables, `is_complete` semantics, and rule shape.
2. **Frontend runtime normalizer** — `frontend/src/lib/division-grid-normalizer.ts::DivisionGridNormalizer.build` calls `workspaceService.getDivisionGridMapping(source, target)` → `{rules:[{source_tier_id,target_tier_id,is_primary,weight}]}`. Keep this read endpoint + shape.
3. **Standings/reads** — `backend/tournament-service/src/rpc/reads.py` builds normalizers with `require_complete=False`. Keep behavior.
4. **Mapping creation funnels through `service.upsert_mapping`** (validated). Auto-map produces rules and MUST go through it (or share its validation).
5. **Commit discipline** — service functions never commit; RPC handlers commit for writes.

## Decision Log

| Decision | Choice | Why |
|---|---|---|
| Management model | In-place grid edit + auto mapping migration (B) | Removes manual version/mapping/activation chores |
| Edit semantics | B1: versions stay internal (immutable), hidden from admin | Preserves immutability/history/standings |
| Auto-map | Hybrid: slug → weighted rank-overlap → conflict | Max automation, manual only on genuinely ambiguous tiers |
| Conflicts at save | Save version (published, not active) + conflict resolver; activate after resolve | Never silently activate an incomplete mapping |
| Grids per workspace | One | Simpler model + UX |
| Cosmetic edits | In-place on current version (name, icon, ow_range, slug, order) | Minimal version churn; fixes typos/art everywhere |
| Classification authority | **Server-side** (new `grid_save`) | Kills current frontend/backend divergence bug |
| Kept features | Import/Export, Marketplace, read-only version history, bulk tier editor | Useful; only lifecycle logic changes |

## Field classification

- **Structural** (→ new version + auto-map + auto-activate): tier added/removed (set of tier ids changes), or `rank_min`/`rank_max` changed on a matched tier.
- **Cosmetic** (→ in-place on current version): `name`, `icon_url`, `ow_rank_min`, `ow_rank_max`, `slug`, `sort_order`/`number`.

Rationale: the runtime normalizer keys on tier **id** and **rank ranges**; nothing else affects normalization.

## Auto-mapping algorithm (pure function)

`generate_mapping_rules(source_tiers, target_tiers) -> (rules, conflicts)`

For each source tier `S`:
1. **slug match**: target `T` with `T.slug == S.slug` → one rule `S→T` weight `1.0`, `is_primary=True`.
2. **rank overlap** (no slug match): with `ceiling = max(finite rank_max over source+target) + 1`, treat `rank_max is None` as `ceiling`. For each target `T`, `overlap = max(0, min(S.max*, T.max*) - max(S.min, T.min))`. If any `overlap > 0`: emit a rule per overlapping `T` with `weight = overlap / sum(overlaps)` (rounded 6 dp; residual added to the max-overlap target so the sum is exactly `1.0`); `is_primary` = the max-overlap target.
3. **neither** → conflict `{source_tier_id, slug, name}`, no rule.

Output rules per source version feed `upsert_mapping`; `is_complete = (conflicts is empty)`.

## New/changed API surface

- **NEW** `grid_save` — `PUT /api/v1/division-grids/by-workspace/{workspace_id}/grid`, body `DivisionGridSaveRequest {name?: str, tiers: DivisionGridTierWrite[]}` → `DivisionGridSaveResult {mode, grid: DivisionGridRead, active_version_id, readiness}`. Permission `division_grid.update`. Commits. Requires: RPC subject `rpc.tournament.grid_save`, Go gateway route (before wildcard `/{grid_id}/versions`), `openapi_schemas.py` + `openapi_docs.py` entries, frontend `workspaceService.saveWorkspaceGrid`.
- **ENRICH** `DivisionGridActivationReadiness` (+`sources: DivisionGridReadinessSource[]`, each `{version_id, version_label, grid_name, tournament_count, tournament_names, status, conflict_tiers}`). Same subject `grid_version_readiness`; frontend type extended. Existing fields kept for back-compat.
- **REUSE** for resolver: `getDivisionGridMapping` + `putDivisionGridMapping` + `activateDivisionGridVersion`.
- **UNUSED by new UI (endpoints kept):** create/update/publish/clone version, delete version.

---

## PHASE A — Backend: auto-mapping engine (pure, TDD)

### Task A1: `generate_mapping_rules` pure function
**Files:**
- Create: `backend/tournament-service/src/services/division_grid/automap.py`
- Test: `backend/tournament-service/tests/test_division_grid_automap.py`

Follow the existing unit-test bootstrap (sys.path + importlib) from `tests/test_division_grid_management.py`. No DB.

Steps (TDD):
1. Write failing test: identical grids (same slugs) → one primary rule per tier, weight 1.0, no conflicts.
2. Run, verify fail.
3. Implement slug-match branch.
4. Test: renamed slug but same rank range → rank-overlap yields the overlapping target, primary, weight 1.0.
5. Test: source tier spanning two target tiers → two rules, weights ∝ overlap summing to 1.0, primary = larger overlap.
6. Test: open-ended `rank_max=None` on source and/or target handled via ceiling.
7. Test: source tier with no slug match and no overlap → conflict entry, no rule.
8. Test: weights rounding residual assigned to primary so sum == 1.0 exactly.
9. Implement to green; refactor.

Data structures: accept lightweight tier objects (id, slug, name, rank_min, rank_max). Return `(list[DivisionGridMappingRuleWrite], list[ConflictTier])` where `ConflictTier` is a small dataclass/dict `{source_tier_id, slug, name}`. Reuse `schemas.DivisionGridMappingRuleWrite`.

Commit: `feat(divisions): add hybrid auto-mapping rule generator`.

---

## PHASE B — Backend: save orchestration + readiness

### Task B1: classify diff helper
**Files:** `service.py` (new `_classify_tier_change(active_tiers, payload_tiers) -> "cosmetic"|"structural"`), test in `test_division_grid_management.py`.
TDD: added tier → structural; removed → structural; rank_min/max change → structural; only name/icon/ow/slug/order change → cosmetic; no active version → structural.

### Task B2: `save_workspace_grid` service fn
**Files:** `service.py`, tests (mocked session, per test infra).
Logic:
1. Resolve workspace's single grid (grid holding `default_division_grid_version_id`, else newest non-archived, else `create_grid`). 
2. `active_version` = default version in that grid, else latest.
3. Classify (B1).
4. Cosmetic → mutate active version tiers in place (reuse update_version internals for cosmetic fields; must allow published) + optional grid.name. `mode="in_place"`.
5. Structural → `create_version` → `publish_version` → for each source in `get_workspace_source_version_ids ∪ {active_version.id}` (≠ new): `generate_mapping_rules` → `upsert_mapping(is_complete=no conflicts)`. Then `get_activation_readiness`; if ready → `activate_version`, `mode="new_version_activated"`, else `mode="new_version_pending"`.
6. Return `DivisionGridSaveResult`.
TDD covers both branches + conflict-pending branch (no activation).

### Task B3: allow cosmetic in-place on published version
**Files:** `service.py::update_version` (or a dedicated `_apply_cosmetic`).
Change: permit `name/icon_url/ow_rank_*/slug/sort_order` edits on `status=="published"`; still reject structural edits on published. TDD: cosmetic patch on published succeeds; structural patch on published raises 409.

### Task B4: enrich readiness
**Files:** `service.py::get_activation_readiness`, `schemas/division_grid.py`.
Add `sources` with labels + tournament counts/names (query `Tournament.division_grid_version_id`) + `conflict_tiers` (source tiers lacking a rule in the mapping). Keep old fields. TDD: readiness reports conflict tiers and tournament names.

Commits per task. Run: `cd backend && uv run pytest tournament-service/tests/test_division_grid_automap.py tournament-service/tests/test_division_grid_management.py -q`.

---

## PHASE C — Backend: schemas + RPC + one-grid + migration

### Task C1: schemas
Add `DivisionGridSaveRequest`, `DivisionGridSaveResult`, `DivisionGridReadinessSource`; extend `DivisionGridActivationReadiness`. (tournament-service; mirror to app-service/parser-service schemas only if those serve it — verify.)

### Task C2: RPC subject `grid_save`
**Files:** `rpc/integrations.py` (+ `openapi_schemas.py`, `openapi_docs.py`). Permission `update`, commit after.

### Task C3: Go gateway route
**Files:** `gateway/internal/tournament/integrations_routes.go` — add `PUT /by-workspace/{workspace_id}/grid → grid_save` (Body, Auth) BEFORE the wildcard `/{grid_id}/versions` entries. Build gateway to verify compile.

### Task C4: one-grid enforcement + data migration
**Files:** new Alembic revision under `backend/migrations` (down_revision `divgrid0002`). Data migration: per workspace, keep canonical grid (the one holding `default_division_grid_version_id`, else newest) and set `archived_at` on the rest (reversible; never delete — tournaments may pin their versions). `create_grid`/`grid_save` resolve the single active grid.

---

## PHASE D — Frontend

### Task D1: service + types
**Files:** `frontend/src/services/workspace.service.ts` (`saveWorkspaceGrid(workspaceId,{name?,tiers})`), `frontend/src/types/workspace.types.ts` (`DivisionGridSaveResult`, `DivisionGridReadinessSource`, extend readiness).

### Task D2: single-grid editor page
**Files:** `frontend/src/app/admin/divisions/page.tsx`.
- Load workspace's single grid; drop grid list selection + version dropdown + manual Publish/Activate/Clone/Fork buttons.
- One "Save" → `saveWorkspaceGrid`. On `new_version_pending` → open conflict resolver. On success → toast reflecting mode.
- Keep the bulk tier editor (`DivisionGridEditorCard`) as the editing surface.

### Task D3: conflict resolver component
**Files:** `frontend/src/app/admin/divisions/ConflictResolver.tsx` (replaces MappingEditor/ReadinessMatrix usage in the flow).
- From enriched readiness `sources`, for each source version with `conflict_tiers`, let admin pick a target tier per conflict tier; merge with existing mapping rules; `putDivisionGridMapping`; then `activateDivisionGridVersion`.
- Behavior test (vitest, presentational, static render) mirroring existing `*.behavior.test.tsx` patterns.

### Task D4: wire kept features
Keep Import/Export, Marketplace (current WIP), read-only version history (list versions + which tournaments pin them) using existing endpoints.

---

## PHASE E — Verification

- `cd backend && uv run pytest tournament-service/tests/test_division_grid_automap.py tournament-service/tests/test_division_grid_management.py -q` green.
- `cd frontend && npx vitest run src/app/admin/divisions` green; `npm run lint` (next lint) clean for touched files.
- Build Go gateway to confirm route compiles.
- Smoke: simulate save flow (cosmetic in-place; structural with clean auto-map → activated; structural with a conflict → pending → resolve → activated) via unit/integration coverage; document what was exercised.

## Risks

- **Data migration mis-selecting canonical grid** → archive is reversible; never delete.
- **Auto-map wrong weights** → covered by pure-function tests; `_validate_mapping` still enforces sum=1.0 + primary.
- **Cosmetic in-place changes history display** — accepted per decision.
- **Go gateway route ordering** — new literal route must precede wildcard `/{grid_id}/versions`.
