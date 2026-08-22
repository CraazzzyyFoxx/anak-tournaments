
# parser-service: OOP + repository refactor — analysis and plan

Date: 2026-08-21
Scope: `backend/parser-service` (150 src files / 21 018 src lines, 44 test files / 7 842 test lines)

## 0. Why, and what precedent this follows

Same mandate as `docs/plans/2026-08-20-app-service-oop-repositories.md` and
`docs/plans/2026-08-21-balancer-service-oop-repositories.md` (executed the day before/same day):
convert procedural `services/*.py` modules (module-level `async def` functions taking `session` as
the first argument, zero classes) into `identity-service`-style classes with constructor-injected
`shared.repository` collaborators and one exported singleton per service, per
`backend/ARCHITECTURE.md`. parser-service is the third and largest service converted under this
mandate — every file in `src/services/` and `src/rpc/` is bag-of-module-level-functions today
(confirmed by a full read-only scout pass across all 18 domains); the achievement-engine and
match-log-processing subsystems make this the biggest single-service conversion so far.

## 1. Current layering (before)

```
serve.py → src/rpc/{achievements,logs,rank,misc,bootstrap,impact,subscription}.py
              transport: decode, gate, one-or-more service calls
              ↓  (rpc/achievements.py and rpc/misc.py ALSO run raw SQL directly — see §2.4)
          src/services/<domain>/{service.py,flows.py}   bag-of-functions, raw SQL, scattered commits
          src/services/achievement/engine/**             plugin-registry condition evaluators (already
                                                            a clean shape, see §2.6) + seeder/runner/differ
              ↓
          shared/repository/*.py   BaseRepository[Model] + concrete CRUD repos (partial coverage —
                                     several parser-only models have no repository yet, see §3)
```

Every file in `src/services/` is module-level procedural code except: `overwatch_rank/client.py`
(`OverFastRankClient` — already class-shaped, no change needed), `map/service.py` (already
delegates to a module-level `_map_repo = MapRepository()`, the one place already following the
target shape), `subscription_collection/scheduler.py`/`overwatch_rank/scheduler.py` (already hold a
`_scheduler = IntervalScheduler(...)` instance of a *shared* class), and a handful of frozen
dataclasses (`PortableAchievementRule`, `EvalContext`, `DiffResult`, `EvaluationSlice`,
`CanonicalRuleMeta`, `GroupSpec`, `TournamentTarget`, `_ChallongeParticipantRow`,
`_ParticipantGroupContext`, `_ParticipantFetchPlan`, `PlayerRef`, `BaselineSet`, `ImpactContext`,
`ReaperResult`, `_Stalled`, `ParsedRank`, `RankFetchResult`). Zero domain classes exist anywhere in
`src/services/`.

## 2. Defects found (analysis, before code changes)

### 2.1 Four files are 100% dead code — delete, don't convert

`src/services/admin/{stage.py (1120 lines), tournament.py (377 lines), standing.py (73 lines),
player_sub_role.py (139 lines)}` have **zero importers anywhere in `backend/`** — no `routes/`
directory exists in parser-service (confirmed: `parser-service/src/routes` does not exist), and no
`rpc/*.py` module imports `services.admin.{stage,tournament,standing,player_sub_role}`. Every one is
a near-verbatim copy of the live twin in `tournament-service/src/services/admin/{stage,tournament,
standing,player_sub_role}.py` (same function names, same docstrings, matching relative line
offsets) — responsibility for bracket/stage/tournament/standing administration moved to
tournament-service and these parser-service copies were never deleted. Their tests
(`test_admin_stage_service.py`, `test_admin_tournament_service.py`, `test_seed_teams.py`) exercise
only this dead code (`standing.py`/`player_sub_role.py` have **no** test files at all — further
confirming zero live usage). Action: **delete**, not migrate.

### 2.2 Stale `APPROVED_DIRECT_WRITE_FILES` allowlist entries (`backend/tests/test_repository_boundaries.py`)

Confirmed dead (files do not exist in parser-service at all):
`parser-service/src/routes/achievement.py`, `.../routes/admin/achievement_rule.py`,
`.../routes/admin/discord_channel.py` (no `routes/` dir), `.../services/challonge/sync.py`
(challonge/ only has `service.py`), `.../services/encounter/map_veto.py` (encounter/ only has
`flows.py`/`service.py`), `.../services/admin/{encounter,team,user,user_merge}.py` (admin/ only has
`stage,tournament,standing,settings,player_sub_role`), `.../services/standings/service.py`
(standings/ only has `recalculation.py`). Confirmed present-but-dead-code (§2.1):
`services/admin/{stage,tournament,standing,player_sub_role}.py`. Confirmed present and
**still accurate** (real write sites, kept until migrated): `services/achievement/engine/
{differ,runner,seeder}.py`, `services/achievement/import_export.py`,
`services/match_logs/{flows,log_records}.py`. Confirmed **stale** on closer read (zero write-regex
matches today): `services/match_logs/service.py` (pure reads only), `services/gamemode/service.py`
(already listed but the file has one real write site at `create` — keep until §4 converts it),
`services/hero/service.py` / `services/map/service.py` / `services/team/{flows,service}.py` /
`services/tournament/service.py` / `services/encounter/service.py` / `services/standing.py` — all
have real, current write sites, kept until §4 converts them.

**Pre-existing gap, found independent of this refactor:** `services/overwatch_rank/service.py` has
8 regex-matching raw-write sites (`session.add` ×3, `sa.insert(...).from_select` ×2, `sa.update` ×3)
and **zero** allowlist entry — `test_repository_boundaries.py` should currently be failing for
parser-service on this file. Not introduced by this plan; resolved as a side effect of §3's
`shared/repository/ranks.py` extraction (the raw writes move into `shared/repository/`, which the
test's own `relative.startswith("shared/repository/")` check already exempts).

### 2.3 Zero classes anywhere in `services/`

Every domain is a flat module of `async def foo(session, ...)` functions. `session` is already
correctly threaded as a parameter everywhere (never stored on an instance — confirmed for
`match_logs/flows.py`'s `MatchLogProcessor`, the one existing class, whose `__init__` takes
`tournament, name, data_in, s3, log_record_id` and never `session`), so the conversion is a
mechanical "wrap these functions in a class + export one singleton" pass per domain, not a
session-ownership fix.

### 2.4 SQL and raw commits in the transport layer

`rpc/achievements.py` (685 lines) directly constructs/mutates/deletes `AchievementRule` and
`AchievementOverride` rows in 5 handlers (`_create`, `_update`, `_delete`, `_override_create`,
`_override_delete`) instead of calling a service method, and redundantly re-commits after calling
`seed_workspace`/`hard_reset_workspace`/`run_evaluation` (§2.5) in `_seed`/`_reset`/`_evaluate`/
`_calculate`/`_calculate_tournament`/`_update` (the last one triple-commits: once for the rule save,
once inside the `run_evaluation` it triggers). `rpc/misc.py` (146 lines) is worse: it directly
`import`s `sqlalchemy.select`/`delete` and runs the entire discord-channel CRUD
(`_discord_get`/`_discord_upsert`/`_discord_delete`) inline with no service layer at all, plus its
`_sync_handler` factory (used by all 3 OverFast syncs) commits *after* calling
`hero_flows.initial_create`/`map_flows.initial_create`/`gamemode_flows.initial_create`, each of
which **already commits internally** — a confirmed redundant double-commit. `rpc/logs.py`'s `_retry`
handler runs a raw `select` + in-place field mutation + commit inline instead of calling a service.
By contrast `rpc/{bootstrap,subscription,impact,rank}.py` are already fully compliant (zero SQL,
zero commit, one service call per handler) — nothing to fix there beyond import renames as their
callees convert.

### 2.5 Correctness-critical primitives to preserve byte-identical

- `services/achievement/engine/differ.py`'s `_DEDUP_INDEX_ELEMENTS` (a
  `sa.func.coalesce(col, sa.literal_column("0"))` conflict-target tuple matching migration
  `perfidx05`'s functional unique index) — the riskiest single item found in the whole scout pass.
  Any rewrite that changes the expression shape silently breaks the `ON CONFLICT DO NOTHING`
  idempotent-reconcile guarantee, reintroducing the duplicate-key `IntegrityError` storm this code
  exists to prevent.
- `services/achievement/engine/runner.py`'s `async with session.begin_nested():` (SAVEPOINT-scoped
  per-rule evaluation) and `_is_connection_lost`'s exact exception classification
  (`PendingRollbackError`/`connection_invalidated`/`InterfaceError`) — prevents one rule's failure
  from rolling back the whole evaluation run and prevents duplicate Sentry storms on connection loss.
- `services/match_logs/reaper.py`'s stall-recovery claim query: `sa.select(LogProcessingRecord)
  .where(stalled_conditions(...)).order_by(created_at).limit(limit).with_for_update(skip_locked=True)`
  — the entire stall-recovery mechanism (README.md's "Match-log stall recovery") depends on this
  exact lock shape; must move into `LogProcessingRepository.claim_stalled` verbatim.
- `services/overwatch_rank/service.py`'s `select_and_claim_due` (claim-then-jittered-reschedule
  pattern, `ORDER BY priority_tier DESC, last_checked_at ASC NULLS FIRST`) and its priority-tier
  bulk `UPDATE`s — must move into named `BattleTagRankStateRepository` methods with the exact
  WHERE/ORDER BY preserved, mirroring the balancer-service precedent's treatment of
  `DraftPickRepository.finalize_if_on_clock`.
- `services/catalog_aliases.py`'s `build_miss_upsert` (`pg_insert(...).on_conflict_do_update(...)`
  with `resolved_at: None` reset-on-conflict — "a name showing up again reopens a dismissed miss")
  — a business-rule-bearing conflict clause, not a generic upsert.
- `services/team/flows.py`'s `_fetch_challonge_participant_rows` and `services/tournament/flows.py`'s
  `create_groups`/`create_with_groups`: each does a **mid-flow `await session.commit()` before a
  rate-limited external HTTP round-trip to Challonge**, releasing a pgBouncer transaction-pooling
  slot for the duration of the network wait. These are not service-boundary commits and must **not**
  be collapsed into a single end-of-flow commit when the surrounding function becomes a class method.
- `services/subscription_collection/service.py`'s `collect_subscriptions_for_active_tournaments`
  commits **per batch** (with a matching per-batch `rollback` on exception) so one tournament's
  provider outage doesn't discard already-processed batches — must stay multi-commit.
- `services/baselines/flows.py`'s `recompute`: `sa.delete(StatBaseline)` then `session.add_all(...)`
  for a `formula_version` must stay one atomic unit (one repository method, one transaction) — a
  caller-mediated gap between delete and insert would leave the baseline table empty on a mid-way
  failure.

### 2.6 What NOT to convert (repository-boundaries.md's explicit exemptions, confirmed applicable)

- `services/achievement/engine/conditions/*.py` (24 files, ~3500 lines) — a clean read-only
  `@register("<type>")` plugin-registry dispatched via `execute_leaf`; every leaf takes
  `(session, params, context)` and only ever `SELECT`s. `repository-boundaries.md` explicitly
  exempts "achievement condition ... queries" from CRUD-repository hiding. These stay exactly as
  free functions; forcing a class onto them would be the "pointless split" `ARCHITECTURE.md` and the
  app-service correction pass both warn against. Only `_stage_filters.py` (pure filter-builders,
  zero session) moves to `src/domain/`.
- `services/overwatch_rank/read_service.py` (→ renamed `queries.py`, `RankQueries` class) and
  `services/subscription_collection/admin.py`'s `get_collection_stats` — analytical
  aggregate/DISTINCT-ON queries stay in a service/queries class, never a `BaseRepository` subclass.
- `services/standings/recalculation.py` — pure event-publishing plumbing (zero session, zero DB);
  `services/s3/service.py` — thin S3-client wrapper (zero session; S3 puts/deletes aren't the
  `models.*` writes this refactor governs); `services/challonge/service.py` — thin re-export of
  `shared.clients.challonge.ChallongeClient` bound methods, zero DB access. None of these get a
  class: there is no orchestration or DB access to inject collaborators into (ARCHITECTURE.md: "a
  domain gets a class only where there is real DB access and orchestration").
- `services/match_logs/{result_events,realtime}.py` — single IO functions with no state to hold.

### 2.7 Domain-extraction opportunities (pure, zero `session`/`await`) — the largest found across any service converted so far

| File | Pure lines / total | Destination |
|---|---|---|
| `achievement/engine/validation.py` | 349 / 349 (100%) | `src/domain/achievement_validation.py` |
| `achievement/engine/context.py` | 52 / 52 (100%) | `src/domain/achievement_eval_context.py` |
| `achievement/engine/catalog.py` | 847 / 847 (100%, static data) | merged into achievement catalog domain module |
| `achievement/engine/seeder.py` | ~1050 / 1180 (rule-builder functions) | `src/domain/achievement_catalog.py`, leaving ~130 lines of `seed_workspace`/`hard_reset_workspace` as the DB-touching service |
| `match_logs/impact.py` | 100% | `src/domain/match_logs/impact.py` verbatim |
| `match_logs/backfill.py` | `rebuild_frames`/`_pivot`/`_merge_events`/`_rank_by_impact` | `src/domain/match_logs/impact_backfill.py` |
| `overwatch_rank/{scheduler.compute_per_tick, mapping.build_default_lookup+map_division_tier_to_rank_value, date_range._resolve_date_range, service.battle_tag_to_slug, client.parse_competitive, schemas.py's dataclasses}` | small pure pieces | `src/domain/overwatch_rank.py` |
| `baselines/flows.py`'s `build_baseline_rows`/`_baseline_row` | already docstring-marked pure | `src/domain/baselines.py` |
| `team/flows.py`'s 3 dataclasses + `normalize_challonge_team_name`/`_effective_challonge_id`/`_build_team_suggestion_index`/`_suggest_team_id`/`_validate_challonge_team_mappings`/`resolve_team_placement`/`_to_materialization_teams` | | `src/domain/challonge_team_sync.py` |
| `tournament/flows.py`'s `get_groups_from_matches`/`_apply_stage_challonge` | | `src/domain/tournament_groups.py` |
| `hero/flows.py`'s `merge_aliases` | | `src/domain/hero_aliases.py` |
| `subscription_collection/service.py`'s `_chunked`/`TournamentTarget` | | `src/domain/subscription_collection.py` |

Trivial one-liners (`_clean`, `battle_tag_to_slug`, `_usernames`) stay as private module helpers —
YAGNI, not worth a domain-module file for 2-3 lines each (per `ARCHITECTURE.md`: "Do not force a
class [or module split] onto pure code just to match the pattern").

### 2.8 Minor correctness/perf smells found alongside the main conversion

- `map/flows.py`'s and `user/flows.py`'s `to_pydantic(session: AsyncSession, ...)` never use
  `session` — dead parameter, same class of defect the app-service precedent found and fixed.
- `hero/flows.py`'s `initial_create` fetches 13 Blizzard locales **sequentially** (comment
  acknowledges the cost, not the sequential-ness); `team/flows.py`'s Challonge participant fetch
  already uses `asyncio.gather` + a semaphore(4) for the same shape of problem — the pattern to
  mirror. `map/flows.py`'s per-gamemode fetch loop is the same issue at smaller scale (2-3
  gamemodes, lower priority).
- `services/encounter/service.py::create_match` takes a `commit: bool = True` parameter — a
  repository-shaped function with a commit toggle, the exact anti-pattern `ARCHITECTURE.md`'s
  flush-only rule exists to prevent; collapses to flush-only once behind `MatchRepository`.
- `services/hero/service.py::create` and `services/gamemode/service.py::create` appear to have zero
  callers (bulk sync paths use `session.add_all` directly, bypassing these single-item functions) —
  flagged, not deleted without a final whole-backend grep confirmation during §4 execution.
- `services/admin/settings.py`'s `upsert_setting` already commits internally; `rpc/misc.py`'s
  `_settings_upsert` handler commits **again** immediately after — redundant, fix by dropping the
  rpc-level commit.
- `services/match_logs/log_records.py` has 4 near-identical `select(LogProcessingRecord).where(...).
  order_by(created_at.desc()).limit(1)` queries differing only by status filter — collapse into one
  parametrized repository method.
- `services/overwatch_rank/service.py`'s two bulk-insert blocks (`seed_states_for_all_battle_tags`
  and the tier-1 branch of `seed_states_from_registrations`) are near-duplicate `sa.insert(...)
  .from_select(...)` shapes differing only by an extra `priority_tier` literal and a `target_ids`
  filter — collapse into one parametrized `BattleTagRankStateRepository.bulk_seed_missing` method.

## 3. Target design

```
shared/repository/
    support.py      EXTENDED  + AchievementEvaluationResultRepository (bulk_delete_by_ids,
                               delete_for_rules, bulk_upsert_ignore_conflicts — carries
                               _DEDUP_INDEX_ELEMENTS verbatim), + EvaluationRunRepository (create,
                               mark_failed), LogProcessingRepository gains find_reusable, find_latest,
                               find_latest_incomplete, claim_stalled (with_for_update(skip_locked=True)
                               moved verbatim from reaper.py), DiscordChannelRepository gains
                               get_by_tournament_id, delete_by_tournament_id
    catalog.py      EXTENDED  CatalogAliasMissRepository gains record_miss (wraps build_miss_upsert
                               verbatim, including the resolved_at-reset-on-conflict clause)
    tournament.py   EXTENDED  + TournamentGroupRepository (create + get_by_tournament_stage_and_name),
                               + StageItemInputRepository (create/delete) — kept in this file since
                               its siblings Stage/StageItem/Team/Player/Encounter/Match/Standing repos
                               already live here (topical-file convention)
    workspace.py    EXTENDED  WorkspaceMemberRepository gains bulk_get_or_create (batch ON CONFLICT
                               DO NOTHING + re-SELECT, mirroring team/service.py's exact shape)
    baselines.py    NEW       StatBaselineRepository.replace_for_version (atomic delete+bulk-insert,
                               one method — see §2.5)
    match_logs.py   NEW       MatchStatisticsRepository, MatchEventRepository, MatchKillFeedRepository
                               (delete_for_match[_by_names], create_many inherited)
    ranks.py        NEW       RankSnapshotRepository, BattleTagRankStateRepository (get_by_social_
                               account_id, create_for_tag, bump_priority, bulk_seed_missing,
                               demote_tier1_not_in, promote_tier0_in, claim_due, reenable_disabled,
                               defer — every bulk statement's exact WHERE/ORDER BY preserved),
                               RankFetchLogRepository

src/domain/         NEW package — achievement_validation.py, achievement_eval_context.py,
                    achievement_catalog.py, match_logs/impact.py, match_logs/impact_backfill.py,
                    overwatch_rank.py, baselines.py, challonge_team_sync.py, tournament_groups.py,
                    hero_aliases.py, subscription_collection.py — every module here has zero
                    AsyncSession/await/asyncio and a curated __all__ (per §2.7)

src/services/<domain>/
    DEAD (deleted, §2.1): admin/{stage,tournament,standing,player_sub_role}.py
    UNCHANGED (§2.6):      achievement/engine/conditions/*.py, standings/recalculation.py,
                           s3/service.py, challonge/service.py, match_logs/{result_events,realtime,
                           event_models}.py, overwatch_rank/client.py (already class-shaped)
    CONVERTED (bag-of-functions -> class + singleton, session stays a method param):
        achievement/     AchievementRuleService (rpc's inline create/update/delete + override CRUD),
                          AchievementEngineService (seed_workspace/hard_reset_workspace/run_evaluation/
                          diff_and_apply — wraps seeder.py+runner.py+differ.py), import_export.py's
                          functions -> AchievementImportExportService, admin_reads.py -> stays thin
                          functions (read-only, no orchestration to inject)
        match_logs/      MatchLogProcessor (flows.py, unchanged shape, repository-backed writes),
                          LogRecordsService (log_records.py), ReaperService (reaper.py),
                          BackfillService (backfill.py), UploadService (uploads.py),
                          MatchLogReadService (service.py's battle-name resolution), AdminReadsService
                          (admin_reads.py)
        overwatch_rank/  RankStateService (service.py's write/orchestration half), RankAdminService
                          (admin.py), RankQueries (read_service.py renamed queries.py) — scheduler.py/
                          tasks.py/mapping.py stay function-shaped consumer/orchestration modules
                          calling the new singletons (they are RabbitMQ-consumer/APScheduler
                          entrypoints, analogous to rpc handlers, not domains needing their own class)
        team/            TeamFlowsService (flows.py), TeamService (service.py)
        tournament/      TournamentFlowsService (flows.py), TournamentService (service.py)
        encounter/       EncounterService (service.py; flows.py's one function stays thin, no class)
        subscription_collection/  SubscriptionCollectionService (service.py), SubscriptionAdminService
                          (admin.py) — scheduler.py stays function-shaped (APScheduler entrypoint)
        baselines/       BaselineService (flows.py + service.py merged: recompute + get_active +
                          invalidate_cache)
        hero/, map/, gamemode/    HeroService, MapService, GamemodeService (service.py+flows.py merged
                          per domain — each is small enough that ARCHITECTURE.md's "small domains keep
                          everything in one service.py" applies)
        user/            UserService (service.py+flows.py merged; to_pydantic drops the unused
                          session param and moves to a plain sync function)
        catalog_aliases.py  stays a thin module-level function (record_misses) that opens its own
                          session by design (§2.5) and calls the new
                          CatalogAliasMissRepository.record_miss — NOT folded into a class, since
                          ARCHITECTURE.md's own session-per-method-param rule doesn't fit a function
                          that deliberately manages its own session lifecycle

src/rpc/*.py         zero SQL, zero commit, every handler calls exactly one singleton method:
                     achievements.py loses its 5 inline CRUD sites (-> AchievementRuleService) and its
                     redundant re-commits after AchievementEngineService calls (which own their
                     commit); misc.py loses its inline discord-channel CRUD (-> new
                     DiscordChannelService, backed by DiscordChannelRepository) and its redundant
                     _sync_handler commit (hero/map/gamemode services already commit internally);
                     logs.py's _retry delegates to LogRecordsService.retry; bootstrap.py/
                     subscription.py/impact.py/rank.py need only import-path updates
```

Rules (unchanged from the two precedents):
1. `session` stays a method parameter everywhere; repositories/services are stateless singletons.
2. Collaborators are keyword-only constructor args with singleton defaults.
3. Pure/algorithmic helper functions imported directly by sibling modules or tests **stay
   module-level** (§2.6/§2.7) — a domain gets a class only where there is real DB access and
   orchestration to inject collaborators into.
4. Every correctness-critical primitive in §2.5 moves **byte-identical** — same WHERE/ORDER BY/lock
   mode/conflict-target expression, same commit placement relative to the external network call it
   protects.
5. No compatibility shims: every renamed dotted path is updated at every caller (including every
   test's `monkeypatch.setattr`/`patch.object` target) in the same change.
6. Test-coupling seams cataloged in the scout pass (module-level `patch.object(<module>, "name", …)`
   targets) must keep resolving — either by keeping the referenced name a module-level import inside
   whatever file now hosts the class (test coupling patches the *module's* namespace, not `self.`,
   per the `differ.py`/balancer-service precedent), or by updating the test to the new
   `SingletonName.method` path in the same change.

## 4. Execution (parallelized)

Prerequisite work (main agent, sequential, before any fan-out): delete the 4 dead files + 3 dead
tests (§2.1), prune the 7 stale allowlist lines (§2.2), then write every new/extended repository in
§3's `shared/repository/*.py` list by hand — the "shared prerequisite inline, then fan out" ordering
the two precedents both used, since every domain package below depends on the exact repository
method shapes.

Six work packages then run in parallel against disjoint file sets:

| Package | Files | Risk |
|---|---|---|
| `AchievementPackage` | `services/achievement/**`, `services/catalog_aliases.py`, `rpc/achievements.py` + achievement test files | High — owns the `_DEDUP_INDEX_ELEMENTS` conflict target, the `begin_nested` SAVEPOINT isolation, and 5+ redundant-commit sites to fix |
| `MatchLogsPackage` | `services/match_logs/**`, `rpc/logs.py` + match-log/impact/backfill/reaper test files | High — owns the `with_for_update(skip_locked=True)` reaper claim and the largest single file (`flows.py`, 1350 lines) |
| `OverwatchRankPackage` | `services/overwatch_rank/**`, `rpc/rank.py` (import renames only) + rank/overwatch test files | Medium — owns the priority-tier bulk updates and the claim-then-reschedule pattern, no true row-level lock but still correctness-sensitive |
| `TeamTournamentPackage` | `services/{team,tournament,encounter,challonge}/**`, `rpc/bootstrap.py` (import renames only) + their test files | Medium — owns the two pgBouncer-slot-release mid-flow commits, must not collapse them |
| `CatalogSyncPackage` | `services/{hero,map,gamemode}/**`, `rpc/misc.py` (OverFast-sync + settings + discord-channel handlers) + their test files | Low-medium — mechanical CRUD conversion + the new `DiscordChannelService`/repository extraction + fixing 3 redundant commits |
| `SubscriptionBaselinesPackage` | `services/{subscription_collection,baselines,user}/**`, `rpc/{subscription,impact}.py` (import renames only) + their test files | Low — mechanical conversion, must preserve the per-batch commit/rollback loop verbatim |

The main agent retains `serve.py`'s import/wiring updates (every `from src.services.X import Y` that
changes shape), the `test_repository_boundaries.py` allowlist reconciliation, and final
cross-cutting verification, since those depend on the exact class/singleton names every parallel
package produces.

## 5. Result (executed 2026-08-21)

| Gate | Before | After |
|---|---|---|
| `src/` files / lines | 150 / 21 018 | 153 / 19 625 |
| `tests/` files / lines | 44 / 7 842 | 41 / 6 767 |
| `pytest parser-service/tests` | not run as one suite before (bag-of-functions, no boundary enforcement) | **258 passed, 0 failed** |
| `ruff check parser-service shared` | — | pass (12 import-order findings auto-fixed, all in files this refactor touched) |
| `test_serve_smoke.py` (14 rpc modules + every event consumer) | — | 4 passed — **zero changes needed in `serve.py`**: every cross-package caller kept resolving through the module-attribute compatibility rule (§3 rule 6) |
| `backend/tests/test_repository_boundaries.py` direct-write offenders in parser-service | 4 dead files (deleted) + ~30 real write sites across 14 live files, 0 of them allowlisted for their actual current content (7 allowlist lines were already stale, pointing at nonexistent `routes/`/`admin/{team,user,user_merge,encounter}`/`challonge/sync`/`encounter/map_veto`/`standings/service` paths) | **1** (`achievement/engine/runner.py`'s `_mark_run_failed`, a documented exception — re-attaching an `EvaluationRun` row after `session.rollback()` expires it, required for the failure-bookkeeping write to succeed; not repository-routable without changing session lifecycle semantics) |
| `backend/tests/test_repository_boundaries.py` (whole suite) | fails repo-wide (pre-existing) | still fails, but **zero remaining offenders are in parser-service** — the 27 remaining are tournament-service/analytics-service/shared, unrelated, same as the app-service and balancer-service precedents both found |
| `backend/tests` + `shared/tests` | — | 834 passed, 12 skipped, **3 failed** — `test_db_pool_config.py` (unrelated `ResilientAsyncSession` config, untouched by this refactor) and `test_rank_snapshots.py` (unrelated `shared.services.rank_snapshots` division-grid logic, untouched) are pre-existing; the third is `test_repository_boundaries.py` above |

143 files touched (88 net after counting deletes-that-were-recreated-elsewhere), +4 555 / −13 925 lines (the deletion-heavy skew is the 4 dead admin files, seeder.py's 1180→~150 lines, and catalog.py's 847 lines of static data both moving into `src/domain/`).

### What landed

- **Deleted outright (dead code, zero importers anywhere in `backend/`):** `services/admin/{stage,tournament,standing,player_sub_role}.py` (1 709 lines) and their 3 exclusively-dead-code-exercising tests (`test_admin_stage_service.py`, `test_admin_tournament_service.py`, `test_seed_teams.py`). `challonge/service.py`'s unused `create_participant`/`update_tournament_state` re-exports.
- **New `src/domain/` package** (did not exist before): `achievement_validation.py`, `achievement_eval_context.py`, `achievement_catalog.py`, `achievement_stage_filters.py`, `match_logs/impact.py`, `match_logs/impact_backfill.py`, `overwatch_rank.py`, `baselines.py`, `challonge_team_sync.py`, `tournament_groups.py`, `hero_aliases.py`, `subscription_collection.py` — roughly 2 500 lines of zero-`AsyncSession`/zero-`await` logic relocated verbatim out of the service layer, the single largest domain-extraction pass of the three services converted under this mandate so far.
- **New repository classes:** `shared/repository/support.py` gained `AchievementEvaluationResultRepository` (`bulk_delete_by_ids`, `delete_for_rules`, `bulk_upsert_ignore_conflicts` — carries the `_DEDUP_INDEX_ELEMENTS` conflict target verbatim from `differ.py`), `EvaluationRunRepository`, and `LogProcessingRepository` gained `find_latest`/`claim_stalled` (the `with_for_update(skip_locked=True)` reaper claim, moved byte-identical). `shared/repository/catalog.py`'s `CatalogAliasMissRepository` gained `record_miss`. `shared/repository/tournament.py` gained `TournamentGroupRepository`, `StageItemInputRepository`. `shared/repository/workspace.py`'s `WorkspaceMemberRepository` gained `bulk_get_or_create`. Three new files: `shared/repository/baselines.py` (`StatBaselineRepository`, atomic `replace_for_version`), `shared/repository/match_logs.py` (`MatchStatisticsRepository`, `MatchEventRepository`, `MatchKillFeedRepository`), `shared/repository/ranks.py` (`RankSnapshotRepository`, `BattleTagRankStateRepository` with `claim_due`/`bulk_seed_missing`/`demote_tier1_not_in`/`promote_tier0_in`/`reenable_disabled`/`defer`, `RankFetchLogRepository`).
- **Service classes, one + one singleton per domain:** `AchievementRuleService`, `AchievementSeederService`, `AchievementEvaluationRunnerService`, `AchievementResultDifferService`; `LogRecordsService`, `UploadService`, `BackfillService`; `RankStateService`, `RankAdminService`, `RankQueries`; `TeamService`, `TeamFlowsService`, `TournamentService`, `TournamentFlowsService`, `EncounterService`; `HeroService`, `MapService`, `GamemodeService`, `DiscordChannelService` (new), `SettingsService`; `SubscriptionCollectionService`, `SubscriptionAdminService`, `BaselineService`, `UserService`. Every one constructor-injects its repository collaborators with singleton defaults and exports exactly one module-level instance, per `ARCHITECTURE.md`.
- **Deliberately left function-shaped** (no orchestration to inject collaborators into, per §2.6): all 23 non-`_stage_filters` files in `achievement/engine/conditions/*`, `standings/recalculation.py`, `s3/service.py`, `challonge/service.py`, `match_logs/{result_events,realtime,event_models,admin_reads,service}.py`, `encounter/flows.py`, `overwatch_rank/{scheduler,tasks,mapping,client}.py`, `subscription_collection/scheduler.py`.
- **Correctness-critical primitives verified preserved byte-identical:** `differ.py`'s `_DEDUP_INDEX_ELEMENTS` conflict target; `runner.py`'s `begin_nested()` SAVEPOINT scoping and `_is_connection_lost`'s exception classification; `reaper.py`'s `with_for_update(skip_locked=True)` claim query (pinned by `test_match_log_reaper.py`); `overwatch_rank`'s `claim_due`'s `ORDER BY priority_tier DESC, last_checked_at ASC NULLS FIRST`; the two pgBouncer-slot-release mid-flow commits in `team/flows.py` and `tournament/flows.py` (both still precede their Challonge HTTP round-trip, not collapsed); `subscription_collection`'s per-batch commit/rollback loop; `baselines`' atomic delete-then-insert (`StatBaselineRepository.replace_for_version`).
- **Redundant double/triple-commits removed:** `rpc/achievements.py` (5+ sites re-committing after a service that already committed), `rpc/misc.py`'s `_sync_handler` (committing after `initial_create`, which already commits) and `_settings_upsert` (committing after `SettingsService.upsert_setting`, which already commits).
- **Optimization landed** (the one explicit ask): `hero/service.py`'s `initial_create` now fetches its 13 Blizzard locales via `asyncio.gather` + a semaphore(4) instead of sequentially, mirroring `team/flows.py`'s existing Challonge-fetch concurrency pattern.
- **The module-attribute compatibility rule (§3 rule 6) worked with zero exceptions**: every one of the ~40 cross-package/test-coupling call sites the scout pass identified kept resolving after conversion by binding the old function name to the new singleton's bound method at module level — `serve.py` needed **zero changes**, confirmed by the unmodified boot-smoke test passing.

### Explicitly not done, with reasons

- **`runner.py`'s one remaining raw write** (`_mark_run_failed`'s `session.add(run)` after `rollback()`) stays a documented `APPROVED_DIRECT_WRITE_FILES` exception — the rollback expires/detaches the row, and re-adding it is the correct way to make the subsequent field-mutation-and-commit work; not safely repository-routable without changing the helper's session-lifecycle contract.
- **No cross-service de-duplication** of `resolve_team_placement`/`to_pydantic_player`-shaped serializers independently reimplemented in app-service, tournament-service, and parser-service (flagged during scouting, same finding the balancer-service precedent made) — out of this single-service refactor's scope.
- **The 27 remaining `test_repository_boundaries.py` offenders** (tournament-service, analytics-service, shared) and the 2 unrelated pre-existing failures (`test_db_pool_config.py`, `test_rank_snapshots.py`) are untouched — none reference parser-service code, confirmed by grep and by this refactor's diff not touching any of the files involved.
