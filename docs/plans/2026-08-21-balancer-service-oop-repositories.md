# balancer-service: OOP + repository refactor — analysis and plan

Date: 2026-08-21
Scope: `backend/balancer-service` (draft state machine, admin/balance CRUD, registered-team export,
genetic-algorithm balancing engine)

## 0. Why, and what precedent this follows

Same mandate as `docs/plans/2026-08-20-app-service-oop-repositories.md` (executed the day before):
convert procedural `services/*.py` modules (module-level `async def` functions taking `session` as
the first argument, zero classes) into `identity-service`-style classes with constructor-injected
`shared.repository` collaborators and one exported singleton per service, moving CRUD off ad hoc
`session.execute(sa.select/insert/update/delete(...))` calls and onto repository methods.

`backend/tests/test_repository_boundaries.py` enforces the boundary going forward (regex over
`session.add/add_all/delete/merge`, `await session.get(`, `sa.insert/update/delete(`, outside
`shared/repository/` and outside its `APPROVED_DIRECT_WRITE_FILES` allowlist). Before this change,
balancer-service had exactly 3 allowlisted files (`services/admin/{balancer,balancer_dual_write}.py`,
`services/admin/balance_analytics.py`) and 7 **unlisted, currently-failing** offenders:
`rpc/draft.py`, `services/draft/{clock,lifecycle,role_edit,selection}.py`. `balance_analytics.py`
turned out to have zero regex-matching write sites at all (it only does a `select`) — its allowlist
entry was stale from day one.

## 1. Current layering (before)

```
serve.py → src/rpc/{admin,binary,config,draft,jobs}.py    transport: decode, gate, one service call
              ↓
          src/services/admin/{balancer,balancer_dual_write,balance_analytics}.py   admin/balance CRUD, raw SQL
          src/services/draft/{lifecycle,board,selection,clock,role_edit,export,feasibility}.py   draft state machine, raw SQL
          src/services/{registered_teams,team,user}.py    registered-team export adapters
          src/core/auth.py                                4 ad hoc workspace-id SQL lookups
          src/services/balancer/{algorithm,config,jobs}.py  pure genetic-algorithm engine, ZERO DB access
              ↓
          shared/repository/*.py   BaseRepository[Model] + concrete CRUD repos (none existed yet for
                                     Balancer*/Draft* models — only BalancerRegistrationRepository)
```

Everything except `services/admin/_mappers.py`, `services/balancer/algorithm/**`, `services/balancer/config/**`,
`services/draft/{loaders,_errors,ranks,suggestions}.py`, and `services/role_matching.py` is module-level
procedural code. There is not one class in the touched surface.

## 2. Defects found (analysis, before code changes)

### 2.1 No repository for any Balancer*/Draft* model

`shared/repository/` had `TournamentRepository`/`TeamRepository`/`PlayerRepository` (tournament
domain) and `BalancerRegistrationRepository`/`RegistrationFormRepository`/etc. (registration domain),
but nothing for `BalancerBalance`, `BalancerTeam`, `BalancerBalanceVariant`, `BalancerTeamSlot`,
`BalancerTournamentConfig`, `WorkspaceBalancerConfig` (balance domain) or `DraftSession`, `DraftTeam`,
`DraftPlayer`, `DraftPick`, `DraftAuditEvent` (draft domain). All CRUD against these 11 models was
raw `session.execute(sa.select/insert/update/delete(...))` scattered across 11 files.

### 2.2 Repository-boundary offenders (pre-existing, unlisted)

| File | Sites | Verdict |
|---|---|---|
| `rpc/draft.py` | 7 (2× `session.get`, 1× locked `session.scalar(...with_for_update())`, 1× `session.add`, 3× duplicated `User.id`-by-`auth_user_id` lookup) | Transport layer running SQL directly — the exact violation the app-service precedent fixed for `rpc/{users_admin,catalog_aliases,audit,binary}.py` |
| `services/draft/lifecycle.py` | ~12 (3× `sa.delete` re-seed cleanup, `session.add` × N for teams/players/picks, 2× `session.get`, `sa.delete(DraftSession)`) | Mix of plain CRUD (repository-candidate) and irreducible state-machine orchestration (stays a service method) |
| `services/draft/selection.py` | 1 (`sa.update(DraftPick)` — the atomic conditional finalize) | **Not a defect** — the correct, already-elegant optimistic-lock primitive. Must be preserved verbatim inside a repository method, never generalized into a bare `.update(**kwargs)` |
| `services/draft/clock.py` | 2× `session.get` | Plain CRUD-candidate reads |
| `services/draft/role_edit.py` | 1 `session.add` (audit event), 1 locked `session.scalar(...with_for_update())` | CRUD-candidate + a locking read to preserve verbatim |

`services/draft/board.py`, `export.py`, `feasibility.py`, `services/registered_teams.py` had **zero**
regex-matching sites (reads only, or a write routed through a differently-named session variable —
`registered_teams.py`'s `_on_failure` closure does `await inner.get(BalancerRegistrationTeam, ...)`,
which dodges the literal-`session.get(` regex by construction, per that module's own comment
explaining the workaround for the *other* query in the same function).

### 2.3 Duplication

`services/draft/lifecycle.py::_ACTIVE_STATUSES` and `services/draft/board.py::_ACTIVE` were
byte-identical 4-tuples (`SETUP, READY, LIVE, PAUSED`), independently maintained in two files with no
cross-reference. Centralized as `shared.repository.draft.ACTIVE_DRAFT_STATUSES`.

The `User.id`-by-`auth_user_id` lookup (`sa.select(models.User.id).where(models.User.auth_user_id == user.id)`)
is copy-pasted 4× across `rpc/draft.py`'s `_pick_options`/`_pick_select`/`_pick_override` handlers with
two different extraction shapes (`list(...)` vs `.scalar()`).

### 2.4 Test coupling (the real constraint, same as app-service)

33 test files, **zero shared `conftest.py` fixtures** — every mock/patch seam is local to its file.
Concentrated in: `test_admin_summary.py` (4× `admin_rpc._SF`), `test_balance_exported_event.py` (raw
`session` `MagicMock`s + 1 patch on a `shared.messaging.outbox` import), `test_balancer_config.py` (2×
`balancer_admin_service.get_tournament_config`), `test_registered_export_plan.py` (12× module-level
free-function patches), `test_team_workspace_member.py` (2× `shared.services.team_export.materialization`
patches — outside this refactor's scope). `test_draft_contracts.py` has the one draft-package
monkeypatch: `board.feasibility.resolve_shape` (module-attribute path) — preserved by keeping
`feasibility.py` function-shaped (see §3).

### 2.5 Correctness-critical mechanisms identified (preserve verbatim)

- `selection._finalize`: `sa.update(DraftPick).where(id, version=expected, status='on_clock').values(..., version=version+1).execution_options(synchronize_session="evaluate")`, winner decided by `rowcount == 1`. THE pick-selection race resolver.
- `selection._advance`: `sa.select(DraftPick).where(status='upcoming').order_by(overall_no).with_for_update(skip_locked=True).limit(1)`. Skip-locked row claim for board advance.
- `role_edit.edit_player_role`: `sa.select(DraftPlayer).where(id, session_id).options(...).with_for_update()`. Locking read against concurrent role edits.
- `rpc/draft.py`'s `_seed` handler: `sa.select(DraftSession).where(id).with_for_update()`. Locking read guarding a re-seed.

## 3. Target design

```
shared/repository/
    balance.py    NEW  BalancerTournamentConfigRepository, WorkspaceBalancerConfigRepository,
                        BalancerBalanceRepository, BalancerTeamRepository,
                        BalancerBalanceVariantRepository, BalancerTeamSlotRepository
    draft.py      NEW  DraftSessionRepository, DraftTeamRepository, DraftPlayerRepository,
                        DraftPickRepository, DraftAuditEventRepository, ACTIVE_DRAFT_STATUSES
    registration.py    EXTENDED  BalancerRegistrationRepository.list_active_by_tournament(
                                    ..., with_workspace_member=bool) — replaces the
                                    balance_analytics-only-needed .roles+.workspace_member combo;
                                    NEW BalancerRegistrationTeamRepository

src/services/admin/
    balancer.py            → class BalancerAdminService + balancer_admin_service singleton
    balancer_dual_write.py → folded into BalancerAdminService or a small BalancerVariantService
    balance_analytics.py   → class BalanceAnalyticsService + balance_analytics_service singleton
    _mappers.py            unchanged (pure ORM→pydantic, no DB)

src/services/
    registered_teams.py → class RegisteredTeamsService + registered_teams_service singleton
    team.py              → class TeamService + team_service singleton (to_materialization_teams
                            stays a plain module-level function — export.py imports it directly)
    user.py              unchanged or deleted if zero remaining callers (pure re-export shim today)
    role_matching.py     unchanged (pure algorithm, zero DB)

src/services/draft/
    feasibility.py  unchanged public API (curated __all__, one test monkeypatches
                     board.feasibility.resolve_shape by module path) — internals repository-backed
    loaders.py, _errors.py, ranks.py, suggestions.py   unchanged (pure, zero DB)
    lifecycle.py → class DraftLifecycleService + lifecycle_service singleton
                   (DYNAMIC_ROUND_RULES/round_seat_order/average_seat_order/order_captain_ids/
                   validate_draft_rounds/_map_registration-family stay module-level pure functions —
                   selection.py and tests/test_draft_seat_order.py import them directly)
    board.py     → class DraftBoardService + board_service singleton
    selection.py → class DraftSelectionService + selection_service singleton
                   (DraftResult/_team_slot_counts/_role_openings/resolve_pick_slot/_role_is_legal/
                   mark_role_shortage_paused stay module-level pure functions —
                   tests/test_draft_models.py imports _role_is_legal directly)
    clock.py     → class DraftClockService + draft_clock_service singleton (injects selection_service)
    role_edit.py → class DraftRoleEditService + role_edit_service singleton
                   (RoleEditPreview/RoleEditResult/validate_role_edit_request/preview_role_addition
                   stay module-level, __all__-exported, test-imported)
    export.py    → class DraftExportService + export_service singleton
                   (_draft_to_balancer_payload stays module-level, test-imported)
    realtime.py  unchanged (single pass-through function, zero DB, nothing to inject)

src/rpc/draft.py   zero SQL — every handler calls exactly one of the 6 draft-package singletons
src/rpc/admin.py, rpc/binary.py   call the new admin-domain singletons instead of module functions
src/core/auth.py   4 workspace-id getters become thin repository-backed functions (kept as module-
                    level functions — they're imported as plain functions from 3 rpc/*.py modules,
                    and changing that import shape isn't required by this ticket)
```

Rules (same as the app-service precedent):
1. `session` stays a method parameter everywhere; repositories/services are stateless singletons.
2. Collaborators are keyword-only constructor args with singleton defaults.
3. Pure/algorithmic helper functions that are imported directly by sibling modules or by tests **stay
   module-level** — forcing them into classes would be the "pointless split" the app-service
   correction pass (§6-7 of that plan) explicitly walked back. A domain gets a class only where there
   is real DB access and orchestration to inject repositories into.
4. The atomic conditional UPDATE and the two `with_for_update` locking reads move into repository
   methods **byte-identical** in their WHERE/values/lock-mode shape — this is the entire concurrency
   correctness of the draft pick race and must not be "generalized" away.
5. No compatibility shims: every renamed dotted path is updated at every caller in the same change,
   `rpc/draft.py` and `serve.py` excepted only insofar as they were updated last by design (see §4).

## 4. Execution (parallelized)

Repository files (§3, `shared/repository/{balance,draft}.py` + `registration.py` extension) were
written first, by hand, to fix the exact method shapes every consumer needed before any consumer
code changed — the same "shared prerequisite inline, then fan out" ordering the tooling requires for
safe parallel edits. `feasibility.py` was converted next (foundational dependency for every other
draft-package file, low risk, no class needed per rule 3).

Three work packages then ran in parallel against disjoint file sets:

| Package | Files | Risk |
|---|---|---|
| `AdminRepoRefactor` | `services/admin/*`, `services/{registered_teams,team,user}.py`, `rpc/{admin,binary}.py`, `core/auth.py` (balance/tournament getters), 6 test files | Low — plain CRUD, no concurrency control |
| `DraftLifecycleBoard` | `services/draft/{lifecycle,board}.py` + their tests | Medium — state-machine orchestration, no optimistic-lock primitives of its own |
| `DraftSelectionClockExport` | `services/draft/{selection,clock,role_edit,export}.py` + their tests | High — owns the atomic finalize, the skip-locked advance, and the role-edit locking read; repository methods for these were already correctness-reviewed before the package started, so the task was wiring, not redesign |

The main agent retained `rpc/draft.py`, `serve.py`'s draft-clock wiring, `core/auth.py`'s
draft-specific getters, the `test_repository_boundaries.py` allowlist reconciliation, and final
cross-cutting verification, since those files depend on the exact class/singleton names every
parallel package produced.

## 5. Result (executed 2026-08-21)

| Gate | Before | After |
|---|---|---|
| Direct-write regex offenders in `balancer-service/src` | 7 files (`rpc/draft.py`, `services/draft/{clock,lifecycle,role_edit,selection}.py`) unlisted + 3 files allowlisted for no real reason (`admin/{balancer,balancer_dual_write,balance_analytics}.py`) | **0** |
| `backend/tests/test_repository_boundaries.py` balancer-service entries | 3 stale allowlist lines | **0** (test still fails repo-wide on ~50 pre-existing non-balancer offenders across parser/tournament/analytics-service/shared — unrelated to this change, same as the app-service precedent found) |
| `ruff check` (balancer-service src + shared/repository) | — | pass |
| `python -c "import serve"` (worker boot, all 5 rpc modules + job queue + draft clock) | — | pass |
| `pytest tests` (excl. `test_draft_integration.py`/`test_registered_export_integration.py` — real-Postgres-only, self-skip in ~15–30 min each with no DB reachable in this sandbox; excl. `test_moo_native_gil.py`/`test_config_consistency.py` — unrelated to this change, confirmed zero DB access in the algorithm/config packages) | — | **346 passed, 5 skipped, 0 failed** |
| `test_draft_integration.py` (27 methods), `test_registered_export_integration.py` (8 methods) | — | confirmed self-skip cleanly (DB-unreachable guard fires before any renamed call site executes); not run to completion in this environment (~15–30 min of Postgres connect-timeouts) |

34 files touched, +2 482 / −2 304 lines (excludes 2 unrelated pre-existing working-tree changes to `shared/repository/{support,workspace}.py` — Discord-bot channel-registry methods from a concurrent, unrelated change, left untouched).

### What landed

- **Repositories** (`shared/repository/`, new): `BalancerTournamentConfigRepository`, `WorkspaceBalancerConfigRepository`,
  `BalancerBalanceRepository`, `BalancerTeamRepository`, `BalancerBalanceVariantRepository`, `BalancerTeamSlotRepository`
  (`balance.py`); `DraftSessionRepository`, `DraftTeamRepository`, `DraftPlayerRepository`, `DraftPickRepository`,
  `DraftAuditEventRepository`, `ACTIVE_DRAFT_STATUSES` (`draft.py`); `BalancerRegistrationTeamRepository` +
  `BalancerRegistrationRepository.list_active_by_tournament(..., with_workspace_member=)` (`registration.py`
  extension). `BaseRepository.get()` gained an optional `populate_existing: bool` kwarg (backward compatible,
  default `False`) to cover the one `session.get(..., populate_existing=True)` call site `selection.py` needed.
  `DraftSessionRepository.delete_by_id` was added as the one deliberate exception to "no bulk raw-SQL repo
  methods" — the original `delete_session` explicitly avoided an ORM cascade-load of every child relationship
  (teams/players/picks/roles/hero-entries/audit rows all cascade at the DB level via `ON DELETE CASCADE`), and
  `BaseRepository.delete()` would have traded one statement for potentially hundreds of round trips.
- **Services, admin/balance domain** — `BalancerAdminService`, `BalancerVariantService`, `BalanceAnalyticsService`,
  `RegisteredTeamsService`, `TeamService`, each a class + one exported singleton (`balancer_admin_service`,
  `balancer_variant_service`, `balance_analytics_service`, `registered_teams_service`, `team_service`).
  `services/user.py` deleted (a re-export shim with zero remaining callers, confirmed by a repo-wide grep).
- **Services, draft domain** — `DraftLifecycleService`, `DraftBoardService`, `DraftSelectionService`,
  `DraftClockService`, `DraftRoleEditService`, `DraftExportService`, each a class + singleton
  (`lifecycle_service`, `board_service`, `selection_service`, `draft_clock_service`, `role_edit_service`,
  `export_service`). `feasibility.py`, `loaders.py`, `_errors.py`, `realtime.py`, `ranks.py`, `suggestions.py`,
  `role_matching.py` deliberately kept function-shaped (zero classes) — each is either pure algorithmic code with
  a curated `__all__`/direct test imports, or (feasibility's `load_snapshot`) a single repository-backed read
  with no orchestration to inject collaborators into. Forcing a class onto these would have been the exact
  "pointless split" the app-service precedent's correction pass (§6–7 there) walked back.
- **Correctness-critical mechanisms preserved verbatim, now behind repository methods**:
  `DraftPickRepository.finalize_if_on_clock` (the atomic conditional-UPDATE pick race resolver),
  `.next_upcoming_locked` (`with_for_update(skip_locked=True)` board-advance claim),
  `DraftPlayerRepository.get_for_update` (the role-edit locking read), `DraftSessionRepository.get_for_update`
  (the seed-handler locking read). None of their WHERE/values/lock-mode shapes changed.
- **RPC layer** — `rpc/draft.py` holds zero SQL (previously 7 sites: 2× `session.get`, a locked
  `with_for_update()` read, a `session.add`, and 3 copies of a `User.id`-by-`auth_user_id` lookup with two
  different extraction shapes). The 3 duplicated lookups collapsed into one helper,
  `_actor_player_ids`, backed by the pre-existing `shared.repository.identity.UserRepository.get_id_by_auth_user_id`.
  `rpc/admin.py`/`rpc/binary.py` were already SQL-free; only their call sites moved from module functions to
  the new singletons. `core/auth.py`'s 4 workspace-id getters (1 shared re-export + 3 balancer-local) are now
  thin repository-backed functions instead of inline `sa.select(...)`.
- **Duplication removed** — `lifecycle._ACTIVE_STATUSES` and `board._ACTIVE` (byte-identical 4-tuples) both
  deleted; `DraftSessionRepository.exists_active_for_tournament`/`.get_active_for_tournament` now own that
  status set once (`shared.repository.draft.ACTIVE_DRAFT_STATUSES`).
- **Dead code removed** — `lifecycle._load_full` (zero callers anywhere in `backend/`, confirmed by grep).

### Explicitly not done, with reasons

- **No `.importlinter` contract added.** app-service's four contracts enforce a *deep* sub-domain layer
  hierarchy (`achievements` → `dashboard|user` → `hero|map|statistics|workspace`) that doesn't exist here —
  `services/admin/*` and `services/draft/*` are flat, mutually non-importing domains. The one transport-layer
  rule that mattered (`rpc/*.py` must not run SQL) was verified directly via the boundary-test regex rather
  than a static-import contract, matching `rpc/workspaces.py`'s existing precedent in app-service of importing
  `shared.repository` classes directly for simple lookups (the layering rule bans reaching *analytical query
  classes*, not repositories, from `rpc/*.py`).
- **No `asyncio.gather` batching applied** to `feasibility.load_snapshot`'s or `board.build_board`'s 3
  sequential per-model selects, despite being flagged as the clearest optimization candidate in the initial
  analysis. `AsyncSession` is not safe for concurrent statement execution — gathering them would either raise
  or silently corrupt the shared connection, and opening separate sessions per read would break the "one
  consistent snapshot" guarantee both functions' docstrings promise. Documented as a false lead rather than
  silently dropped.
- **`seed()`'s pick-creation now flushes twice** (once inside `DraftPickRepository.create_many`, once in the
  pre-existing trailing `session.flush()` for the session's status/version fields) instead of once — an
  unavoidable consequence of the boundary test forbidding raw `session.add_all()`; correctness is unaffected,
  cost is one extra round trip on the seed path only.
- **`DraftPlayerRepository.list_by_session` has no default `ORDER BY`.** `board.build_board`'s original query
  had `.order_by(DraftPlayer.id.asc())`; `feasibility.load_snapshot`'s did not. Resolved by adding
  `order_by(id.asc())` unconditionally to the shared repository method — harmless for feasibility's set-based
  matching, restores board.py's original deterministic player ordering.
- **`registered_teams.py`/`team.py`'s underlying `shared.services.team_export.*` orchestrator still bypasses
  the existing `TournamentRepository`/`TeamRepository`/`PlayerRepository`** for its own writes — named as a
  known inconsistency during analysis, explicitly out of scope (it is `shared/` code also used by
  parser-service, not balancer-service-local).

## 6. Follow-up: feasibility split + entities consolidation (same day)

`services/draft/feasibility.py` originally mixed three concerns in one file: 8 pure value
dataclasses, the pure bipartite-matching algorithm, and the DB-backed service. Split into:

- `feasibility.py` — `class DraftFeasibilityService` + `feasibility_service` singleton (DB reads,
  `asyncio.to_thread` offload). Now itself constructor-injected into `lifecycle_service`,
  `board_service`, `selection_service`, `role_edit_service`, `export_service` — every draft service
  reaches feasibility through DI (`self.feasibility.resolve_shape(...)`), not a bare module call.
- `feasibility_algorithm.py` — the pure matching rules (`analyze_draft_feasibility`,
  `evaluate_pick_options`, `build_feasibility_state`, `describe_role_deficits`), re-exporting the
  value types it consumes.
- `entities.py` — every draft-domain dataclass, consolidated from four files that each defined one
  or two inline (`lifecycle.CaptainSeed`/`PlayerSeed`, `selection.DraftResult`/`SlotDecision`,
  `role_edit.RoleEditPreview`/`RoleEditResult`, `suggestions.FitPlayer`/`FitConfig`/`FitResult`),
  mirroring the existing `services/balancer/algorithm/entities.py` precedent for the sibling
  genetic-algorithm package. Producing modules re-import their types (`lifecycle.CaptainSeed` etc.
  still resolves via the module's own import), so no external caller changed.

Deliberately NOT merged into `src/schemas/draft.py` (the pydantic RPC wire contracts): several
entities (`DraftSnapshot`, `DraftResult`) hold live ORM rows, which would force either
`arbitrary_types_allowed` (defeating pydantic's validation) or premature ORM->dict flattening.
`src/openapi_schemas.py`'s `OPERATIONS` dict is the actual wire contract (explicit per-topic
request/response classes) and never references these types — they cross a service boundary, never
the RPC boundary. Note this is a design choice in this service, not a repo-wide enforced rule:
`tournament-service/src/schemas/captain.py` already imports `src.models` directly, so "schemas are
ORM-free" is not a universal, tooled invariant elsewhere in the backend.

`services/balancer/algorithm/feasibility_analyzer.py` (the offline genetic-algorithm package, not
touched by this refactor) has the same dataclasses-mixed-with-algorithm shape `feasibility.py` had —
flagged for a future pass, out of scope here since that file is stable and unrelated to this ticket.

Gates unchanged after the split: 346 passed / 5 skipped / 0 failed, ruff clean, boot smoke green.

## 7. Follow-up: `src/domain/` package — the architecture-layers standard (same day)

§6 put every draft dataclass and the pure matching algorithm in `services/draft/{entities,
feasibility_algorithm}.py` — still inside `services/`, still importable by anything. This pass moves
every zero-I/O, zero-`AsyncSession`, zero-`asyncio` module into a dedicated `src/domain/` package and
establishes the layer boundary as a *standard for this service*, not just a one-off tidy-up:

```
src/domain/                     pure: no ORM I/O, no AsyncSession, no asyncio.to_thread
    matching.py                 BipartiteMatching + maximum_bipartite_matching
                                 (moved verbatim from services/role_matching.py — generic, knows
                                  nothing about players/roles; both the offline genetic balancer and
                                  the live draft import it)
    registered_teams.py         RegisteredExportResult (moved from services/registered_teams.py)
    balancer/                   the offline genetic-algorithm engine (moved from
                                 services/balancer/algorithm/*, 14 files: entities, statistics,
                                 feasibility_analyzer, role_assignment_service, rating_normalizer,
                                 player_loader, moo_backend, determinism, progress, runtime,
                                 captain_assignment_service, result_serializer, input_roles,
                                 role_entries) — was already 100% pure; the move is a pure rename,
                                 zero logic changes, importlinter-equivalent to draft/ below
    draft/
        entities.py              every draft-domain dataclass (moved from services/draft/entities.py)
        feasibility.py           the bipartite-matching rules (moved from
                                  services/draft/feasibility_algorithm.py)
        ranks.py                 role_rank/max_role_rank/slot_rank (moved from services/draft/ranks.py)
        fit.py                   per-player FIT scoring (moved from services/draft/suggestions.py)
        rules.py                 NEW — every pure helper that used to live at module level inside
                                  lifecycle.py/selection.py/role_edit.py (seat ordering, registration
                                  mapping, slot-vocabulary rules, role-edit validation, the
                                  before/after feasibility preview). Consolidates ~28 functions that
                                  were split across three service files for no reason other than
                                  "that's the file that happened to need them first."

src/services/draft/
    lifecycle.py, selection.py, role_edit.py   now class-only: every pure helper deleted from these
        files and re-imported from src.domain.draft.rules / .entities / .fit / .ranks. Each file's
        docstring says so explicitly.
    board.py, export.py         one-line import change (services.draft.ranks -> domain.draft.ranks)
    feasibility.py               DB-backed service unchanged in shape; its algorithm import repointed
                                  to domain.draft.feasibility

src/rpc/draft.py                 repointed: domain.draft.rules for the module-function calls that used
                                  to hang off `lifecycle.*`/`selection.*`; domain.draft.entities for
                                  CaptainSeed/PlayerSeed/DraftResult; domain.draft.fit (as `sug`) for
                                  suggestions scoring
```

### The standard, stated plainly

A function or dataclass belongs in `src/domain/` iff it never touches `AsyncSession`, never awaits,
and never runs on the event loop — i.e. it is safe to call from a sync test with no DB fixture and no
`asyncio.run`. Everything else — anything that loads rows, flushes, or offloads CPU work via
`asyncio.to_thread` — stays a method on a `src/services/<domain>/*.py` class. This is the same rule
§3's rule 3 already stated locally for the draft package ("pure/algorithmic helpers stay module-level");
this pass gives it a physical location so the rule is enforceable by directory, not just by convention.

`src/schemas/` remains the separate, ORM-free pydantic wire-contract layer for the RPC boundary (§6's
reasoning stands unchanged: `DraftSnapshot`/`DraftResult` hold live ORM rows and would force
`arbitrary_types_allowed` or premature flattening). `src/domain/` and `src/schemas/` serve different
masters — `domain` is the internal vocabulary the balancing/draft algorithms think in; `schemas` is
what the RPC wire actually carries — and a handful of names (`DraftFeasibilityReport`,
`DraftPickOption`) legitimately exist in both, converted at the RPC boundary via
`DraftFeasibilityResponse.model_validate(report)`, never passed through directly.

No `.importlinter` contract added, same reasoning as §5: the draft/balancer packages are flat, mutually
non-importing domains, and `src/domain/` importing nothing from `src/services/` (verified by grep, zero
hits) is the one directional rule that matters — it is self-evident from the package's own zero
`AsyncSession`/`asyncio` imports rather than needing static enforcement.

### Verification (executed 2026-08-21)

Every moved function was diff-checked against its pre-move committed source (AST-extracted
function/method bodies, normalized for the expected renames) rather than trusted on sight, after one
such rewrite (`domain/draft/fit.py::player_fit`) was found to have silently dropped the `ROLE_NEED`
autopick strategy branch and flipped the `BEST_AVAILABLE` score sign during transcription. Caught by
this diff pass before it reached tests; fixed by copying the committed function body verbatim instead
of reconstructing it from memory. A second defect (`domain/draft/rules.py::arm_clock` setting
`clock_expires_at = now` instead of `now + timedelta(seconds=pick_time_seconds)` — every armed pick
clock would have expired instantly) was found the same way and fixed alongside it.

| Gate | Result |
|---|---|
| Every moved pure function/method, AST-diffed against git `a582420e` after normalizing expected renames | identical (2 real defects found and fixed; remainder cosmetic docstring rewording only) |
| `ruff check` (whole `balancer-service`) | pass |
| `python -c "import serve"` (worker boot) | pass |
| `pytest tests` (excl. `test_moo_native_gil.py`/`test_config_consistency.py`, real Postgres running + migrated) | **386 passed, 0 failed** |
| Repo-wide grep for stale `services.draft.{entities,feasibility_algorithm,ranks,suggestions}`, `services.role_matching`, `services.balancer.algorithm`, and every renamed private (`lifecycle._map_registration` etc.) import path | 0 hits |

`services/draft/{entities,feasibility_algorithm,ranks,suggestions}.py` and `services/role_matching.py`
deleted (superseded, zero remaining importers). `services/balancer/algorithm/` directory removed (fully
relocated to `domain/balancer/`).
