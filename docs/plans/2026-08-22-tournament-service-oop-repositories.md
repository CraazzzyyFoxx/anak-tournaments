# tournament-service: OOP + repository refactor — analysis and plan

Date: 2026-08-22
Scope: `backend/tournament-service` (registration, encounter/pick-ban, tournament admin,
Challonge sync, division grids, standings, computation jobs, scrims)

## 0. Why, and what precedent this follows

Fourth service in the same conversion series, after
`docs/plans/2026-08-20-app-service-oop-repositories.md`,
`docs/plans/2026-08-21-balancer-service-oop-repositories.md` and
`docs/plans/2026-08-21-parser-service-oop-repositories.md`: convert procedural
`services/*.py` modules (module-level `async def` taking `session` first, zero classes)
into `identity-service`-style classes with constructor-injected `shared.repository`
collaborators and one exported singleton per module, moving CRUD off ad hoc
`session.execute(sa.select/insert/update/delete(...))` onto repository methods.

`parser-service` is the nearest reference for the target shape
(`parser-service/src/services/tournament/service.py`: class, keyword-only repo
constructor args with singleton defaults, `session` as a method parameter).

## 1. Measured starting state

`src/` is 41 177 lines across 155 files; `src/services/` alone is 30 086 lines across
90 files. Compared with the already-converted `parser-service`:

| Metric (services layer) | tournament-service | parser-service |
|---|---|---|
| files | 90 | 80 |
| lines | 30 086 | 11 600 |
| classes | 34 | 37 |
| module-level `def`/`async def` | **863** | 137 |
| `session.{execute,scalar,scalars,get,add,delete,flush,merge}` sites | **582** | 104 |
| `sa.select/insert/update/delete` sites | 384 | 153 |
| references to a `*Repository` | **17** | 116 |
| files with zero classes | 56 / 90 (18 631 lines) | 36 / 80 |

Seventeen repository references across 30 000 lines is the headline: this service
essentially does not use the repository layer.

### 1.1 Models with no repository at all

35 ORM models are accessed with raw SQL from this service and have no
`shared.repository` class. Grouped by the repository file they now belong to:

| New/extended repository file | Models |
|---|---|
| `pick_ban.py` (new) | `PickBanConfig`, `PickBanConfigItem`, `PickBanConfigSlot`, `PickBanConfigSlotItem`, `PickBanSession`, `PickBanEntry`, `EncounterPickBanLedger`, `EncounterReadiness`, `MapVetoConfig`, `MapVetoConfigSlot`, `EncounterVetoSession`, `EncounterMapPool` |
| `encounter.py` (new) | `EncounterCaptainReport`, `EncounterMapCode`, `EncounterMapReport`, `EncounterResultAudit`, `EncounterReportForm`, `EncounterSavedView`, `EncounterLink` |
| `challonge.py` (new) | `ChallongeSource`, `ChallongeParticipantMapping`, `ChallongeMatchMapping`, `ChallongeSyncLog` |
| `division_grid.py` (new) | `DivisionGridVersion`, `DivisionGridTier`, `DivisionGridMapping`, `DivisionGridMappingRule`, `DivisionGridImportJob` |
| `scrim.py` (new) | `ScrimRoom` |
| `subscription.py` (new) | `SubscriptionProviderConfig`, `WorkspaceSubscriptionRequirement` |
| `tournament.py` (extended) | `PlayerSubRole`, `TournamentPreviewAccess`, `TournamentPhaseSchedule`, `TournamentComputationJob`, `TournamentRecalculationState` |
| `registration.py` (extended) | `BalancerRegistrationTeamInvite`, `BalancerRegistrationGoogleSheetBinding` |

### 1.2 Correctness-critical mechanisms found (preserve verbatim)

Each is a concurrency primitive whose WHERE/values/lock-mode shape is the whole
correctness argument. Each moves into a *named* repository method unchanged — never
generalized into `BaseRepository.update(**kwargs)`:

- `registration/teams.py` invite redemption: `sa.update(BalancerRegistrationTeamInvite).where(id, state=PENDING, not-expired).values(state=ACCEPTED, accepted_at=...).returning(id)` — decided by whether `RETURNING` produced a row. Two simultaneous redemptions of one link must not both win. → `BalancerRegistrationTeamInviteRepository.consume_if_pending`.
- `computation/jobs.py` `_ensure_recalculation_state`: `pg_insert(...).on_conflict_do_update(requested_generation = requested_generation + 1)` followed by `select(...).with_for_update()`. Two mutations landing together must each advance the generation exactly once. → `TournamentRecalculationStateRepository.ensure_locked`.
- `computation/jobs.py` `get_job(for_update=True)`: the claim/fail lock, so two pollers cannot both transition one job. → `TournamentComputationJobRepository.get_job(for_update=)`.
- `division_grid/import_jobs.py` claim: conditional `sa.update(...).where(status == from_status)` decided by `rowcount == 1`. → `DivisionGridImportJobRepository.claim_queued`.
- `registration/subscription_config.py` and the two provider/requirement upserts: `pg_insert(...).on_conflict_do_update(constraint=<named>)` **plus** a follow-up read with `execution_options(populate_existing=True)`. The `populate_existing` is load-bearing, not decoration — the upsert writes behind the ORM's back, so a plain SELECT is served from the identity map and returns the pre-upsert JSON blob. → `SubscriptionProviderConfigRepository.upsert`/`.get_for_provider(populate_existing=)`, `WorkspaceSubscriptionRequirementRepository.upsert_default`.
- `pick_ban_session.py`'s `select(PickBanEntry).execution_options(populate_existing=True)` — same identity-map hazard after a bulk entry rewrite. → `PickBanEntryRepository.list_by_session(populate_existing=)`.

### 1.3 Deliberate non-CRUD deletes kept as statement deletes

`PickBanSessionRepository.delete_by_id`, `TournamentPhaseScheduleRepository.delete_for_tournament`,
`EncounterPickBanLedgerRepository.delete_for_encounter`, `PickBanEntryRepository.delete_round_by_status`
and friends issue one `sa.delete(...)` rather than `BaseRepository.delete(instance)`. Same
reasoning as `DraftSessionRepository.delete_by_id` in the balancer conversion: the FKs are
`ON DELETE CASCADE`, and the ORM path would trade one statement for hundreds of round trips
loading children only to delete them.

## 2. Target design

```
shared/repository/
    pick_ban.py       NEW   12 repositories (generic pick/ban engine + legacy map-veto)
    encounter.py      NEW    7 repositories (captain/map reports, audits, saved views, links)
    challonge.py      NEW    4 repositories (+ TOURNAMENT_SOURCE_TYPE, linked_tournament_exists())
    division_grid.py  NEW    5 repositories (versions, tiers, mappings, rules, import jobs)
    scrim.py          NEW    1 repository
    subscription.py   NEW    2 repositories (both upsert-shaped)
    tournament.py     EXT   +5 repositories (sub-roles, preview access, phase schedule,
                             computation jobs, recalculation state)
    registration.py   EXT   +2 repositories (team invites, sheet bindings)

src/services/<domain>/<module>.py   one class + one singleton per module that touches a session
src/rpc/*.py, serve.py              call the singletons; zero SQL
```

### 2.1 The naming contract (what makes parallel conversion safe)

The domain graph is dense — 30 cross-domain import edges between
`admin`/`challonge`/`computation`/`encounter`/`registration`/`standings`/`team`/`tournament`.
Packages convert their own files in parallel and must be able to rewrite calls into
*other* packages' not-yet-written modules. Three mechanical rules make that possible:

1. **Singleton name** = `<module-stem>_service`, except `service.py` → `<domain>_service`.
   Collisions across domains are harmless (`tournament.flows.flows_service` vs
   `encounter.flows.flows_service` are reached through different module objects).
2. **Method name == the old module-level function name.** A cross-domain call rewrite is
   therefore purely mechanical: `mod.foo(session, ...)` → `mod.<singleton>.foo(session, ...)`.
3. **Only functions that take `session` become methods.** Pure helpers, constants,
   dataclasses and validators stay module-level, keeping rule 3 of the balancer plan
   ("do not force a class onto pure code") and letting a caller decide from the call site
   alone whether a rewrite is needed.

### 2.2 Modules deliberately left function-shaped

`tournament/{events,cache_invalidation,realtime_commit}.py`,
`encounter/realtime_commit.py`, `registration/realtime.py`: thin side-effect emitters
(outbox enqueue, cache-prefix invalidation, realtime patch registration) imported by six or
more modules across four domains. They have no collaborators to inject and converting them
would churn every caller for nothing — the same "pointless split" the app-service correction
pass walked back. Likewise every pure module (`registration/{utils,validation,serializers}.py`,
`division_grid/portable.py`, the bracket generators, …).

## 3. Execution

`shared/repository/**` was written and verified first, by hand, as the shared prerequisite
— every consumer depends on the exact method shapes, so no conversion package authors a
repository file. Packages consume repositories; a package needing an extra method requests
it rather than editing a frozen file.

Seven packages then ran in parallel over disjoint file sets:

| Package | Files | Lines | Raw DB sites |
|---|---|---|---|
| `RegCore` | `services/registration/{service,teams,lifecycle,admin,export,audit,_common,team_rate_limits,status_catalog}.py` | ~5 000 | ~100 |
| `RegAux` | `services/registration/{sheet_sync,sheet_parsing,rank_sources,rank_autofill,mapping_catalog,subscription_*}.py` | ~3 600 | ~30 |
| `EncounterPkg` | `services/encounter/**` (12 files) | 5 886 | 181 |
| `AdminPkg` | `services/admin/**` (14 files) | 4 698 | 226 |
| `ChallongePkg` | `services/challonge/**` (3 files) | 2 313 | 67 |
| `GridPkg` | `services/division_grid/**` (6 files) | 2 434 | 112 |
| `CorePkg` | `services/{tournament,standings,computation,team,scrim,user,map}/**` | 5 090 | 130 |

The main agent retained `src/rpc/**`, `serve.py`, `src/core/**`, the
`test_repository_boundaries.py` allowlist, and final cross-cutting verification — those
depend on the exact singleton names every package produces.

Three of the seven exhausted their budget mid-file and were re-dispatched as narrower
slices (`StageSvc`, `PickBanSess`, `PickBanAct`, `VetoFlows`, `AdminEncReg`, `ScrimSvc`,
`EncCore`, `EncSessions`, `AdminStage`, `AdminRest`). The lesson for the next conversion is
in §6.

## 4. Result (executed 2026-08-22)

| Metric (`src/services/`) | Before | After | parser-service (reference) |
|---|---|---|---|
| classes | 34 | **93** | 37 |
| module-level `def`/`async def` | 863 | **377** | 137 |
| `session.{add,delete,get,merge}` (CRUD-shaped) | ~200 | **32** | — |
| `sa.select/insert/update/delete` | 384 | **123** | 153 |
| references to a `*Repository` | 17 | **461** | 116 |
| files with zero classes | 56 / 90 | **15 / 89** | 36 / 80 |
| raw SQL in `src/rpc/**` | 15 sites | **0** | — |
| `tournament-service` boundary exemptions | 19 (5 of them for deleted files) | **12** | — |

218 files changed, +21 245 / −19 736.

The 237 surviving `session.*` calls in `services/` break down as: 211 unit-of-work calls
(`commit`/`flush`/`refresh`/`rollback`) which this refactor deliberately did not move —
commit ownership is unchanged; 163 `execute`/`scalar`/`scalars` running analytical queries
that `repository-boundaries.md` requires to stay in a service; and 32 CRUD-shaped calls in
the 12 files still carrying a boundary exemption.

### What landed

- **Repositories** (`shared/repository/`): new `pick_ban.py` (12), `encounter.py` (7),
  `challonge.py` (4), `division_grid.py` (5), `subscription.py` (2), `scrim.py` (1);
  `tournament.py` extended with `PlayerSubRoleRepository`, `TournamentPreviewAccessRepository`,
  `TournamentPhaseScheduleRepository`, `TournamentComputationJobRepository`,
  `TournamentRecalculationStateRepository`; `registration.py` extended with
  `BalancerRegistrationTeamInviteRepository`, `BalancerRegistrationRoleRepository`,
  `GoogleSheetBindingRepository`; `workspace.py` gained `lock_by_id` and
  `clear_default_grid_version`. 106 → **109** exported names.
- **Two pre-existing bugs fixed**, both found by conversion agents refusing a near-miss method:
  - `PlayerRepository.get_by_user_and_tournament` filtered on `Player.user_id`, a column
    dropped in the iwrefac07 workspace-anchoring migration. It raised `InvalidRequestError`
    on every call and had zero callers, so nothing caught it. Now goes through
    `workspace_member.has(WorkspaceMember.player_id == ...)` like its sibling.
  - `shared/repository/__init__.py` never imported `.ranks`, so `RankSnapshotRepository`,
    `RankFetchLogRepository` and `BattleTagRankStateRepository` were not importable from the
    package despite `parser-service` importing them from it.
- **`services/challonge/service.py` deleted** in favour of `src/clients/challonge.py`
  exporting `challonge_client` — the six `fetch_x = _client.fetch_x` rebindings were the exact
  anti-pattern `ARCHITECTURE.md` names for this file.
- **`services/registration/admin.py` deleted** — 294 lines of pure re-export (130 imports
  feeding a 130-entry `__all__`) whose own docstring said it existed "so existing import
  sites keep working". Its three importers now name the owning module.
- **`services/encounter/pick_ban_config.py` created** — `rpc/pick_ban_admin.py` had been
  running the whole `PickBanConfig` upsert/delete (including `session.add`/`session.delete`
  and the cascade-scope SELECT) in the transport layer.
- **Concurrency primitives preserved verbatim behind named repository methods**:
  `BalancerRegistrationTeamInviteRepository.consume_if_pending` (the anti-double-redeem
  conditional UPDATE … RETURNING), `.revoke_pending_for_team`,
  `BalancerRegistrationTeamRepository.get_active_for_update` (the roster lock eleven flows
  take), `TournamentRecalculationStateRepository.ensure_locked` (`ON CONFLICT DO UPDATE
  generation + 1` then `FOR UPDATE`), `TournamentComputationJobRepository.get_job(for_update=)`,
  `DivisionGridImportJobRepository.claim_queued` (rowcount-decided claim, now carrying the
  per-attempt resets in the same statement), `PickBanSessionRepository.get_for_encounter(for_update=)`
  / `.lock_by_id`, `EncounterRepository.get_for_update`,
  `SubscriptionProviderConfigRepository.upsert` + its `populate_existing` read-back.

### Behaviour deltas, all deliberate

Ordering refinements where the original left ties unspecified: `PlayerSubRoleRepository`
gained a `label` tiebreak, `TournamentPreviewAccessRepository` sorts `(created_at, id)`,
`TournamentGroupRepository.list_by_tournament_stage` and `PlayerRepository.list_by_related_player`
sort by `id`, `EncounterRepository.list_by_stage` sorts `(round, id)` where `get_by_stage_id`
had no `ORDER BY`, and `EncounterSavedViewRepository.list_for_user` now sorts by the
user-assignable `(sort_order, created_at)` instead of `id`.

Two ordering *bugs* I introduced in the repository layer were caught by agents refusing them
and reverted before landing: `ChallongeSyncLogRepository.list_by_tournament` and
`EncounterResultAuditRepository.list_for_encounter` had been written to sort by `id desc`
where the originals sorted by `created_at desc` — combined with `limit`, that selects a
different page, not merely a different order.

One real change: `EncounterVetoSessionRepository.get_for_encounter(for_update=True)` pairs
the lock with `populate_existing`, which the original locking branch lacked. That branch has
zero call sites today, and a `FOR UPDATE` that then reads the identity-mapped copy is the bug
the flag exists to prevent, so the correct shape was adopted rather than the latent one.

### Verification

| Gate | Result |
|---|---|
| `tournament-service` pytest | **1344 passed, 44 skipped, 0 failed** |
| `backend/tests` (boundary, route parity, error-code parity) | **99 passed** |
| `parser-service` pytest | **244 passed** |
| `balancer-service` pytest | **359 passed, 41 skipped** |
| `ruff check tournament-service/ shared/` | pass |
| `python -c "import serve"` | pass |
| every module under `src/` imports | 155 / 155 |

### Explicitly not done, with reasons

- **No `.importlinter` contract.** Same call as balancer-service: `services/*` here is a
  flat set of domains with a dense but acyclic cross-import graph, not app-service's
  multi-level hierarchy. The one rule that mattered — `rpc/` runs no SQL — is verified
  directly by the boundary-test regex, and now holds at zero sites.
- **12 boundary exemptions remain**, each for a real reason rather than convenience:
  `registration/service.py`'s `ensure_player_identity` keeps `session.get` because the
  identity-map hit is load-bearing (`BaseRepository.get` would add one SELECT per row on the
  5-minute sheet-sync loop); `admin/encounter.py` keeps `session.add`/`session.delete`
  because an outbox-ordering test pins the recalculation enqueue as the transaction's first
  write and `repo.create` flushes; the rest are realtime-commit and bracket-generation
  internals.
- **`TeamRepository.list_by_tournament` not adopted** by `team/service.py`: it adds
  `ORDER BY id`, and that read is served through the cached `teams_by_tournament:*` key, so
  the change would alter what warm cache entries disagree with for no asked-for benefit.
  Flagged as a follow-up.
- **No `asyncio.gather` batching.** Same false lead as the balancer conversion: `AsyncSession`
  is not safe for concurrent statement execution.

## 6. What to do differently next time

Three of the seven original packages ran out of budget mid-file, twice on the same two files
(`admin/stage.py`, 1 779 lines; `encounter/pick_ban_session.py`, 983 lines). One produced
nothing at all because it spent its budget building a "mechanical transformer" script instead
of converting incrementally.

What worked, and should be repeated: authoring the whole repository layer up front as a
frozen shared prerequisite; a mechanical naming contract (`<module-stem>_service`, method
names unchanged, only session-taking functions become methods) so packages could write calls
into each other's not-yet-existing modules; and instructing agents to refuse a repository
method that almost fits. That last rule caught two real bugs and four ordering deltas.

What to change: **size a package by its largest single file, not by its total.** A 1 700-line
file with 56 query sites is one agent's entire budget. Give it its own task, tell it to
convert region by region keeping the file parseable throughout, and say explicitly that
partial-and-correct beats ambitious-and-lost — the three re-dispatched slices that carried
that instruction all landed.
