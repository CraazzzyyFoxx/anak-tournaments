# app-service: OOP + repository refactor — analysis and plan

Date: 2026-08-20
Scope: `backend/app-service` (17 160 src lines / 90 files, 8 251 test lines / 48 files)

## 0. Baseline (measured, this environment)

| Check | Result |
|---|---|
| `pytest app-service/tests` | 323 passed, **8 pre-existing failures**, 172 skipped, 49 s |
| Pre-existing failures | all `tests/test_audit_workspace.py` — `WorkspaceRead.newcomer_scope` receives `None` against a `Literal["global","workspace"]` field. Unrelated to this refactor. |
| 172 skips | Docker/Postgres not running → every `rpc` fixture + `@pytest.mark.db`/`integration` test self-skips. **Analytical SQL cannot be executed in this environment.** |
| `backend/tests/test_repository_boundaries.py` | fails repo-wide (pre-existing); **6 app-service files** are offenders |

## 1. Current layering

```
serve.py  →  src/rpc/*.py            transport: decode params, resolve workspace ctx, envelope()
              ↓
          src/services/<d>/flows.py  orchestration + cashews @cache + ORM→pydantic
              ↓
          src/services/<d>/service.py            analytical SQL + session.execute
          src/services/<d>/_repositories.py      more analytical SQL
          src/services/<d>/_mappers.py           pure sync ORM→DTO  ✅ already right shape
              ↓
          shared/repository/*.py     BaseRepository[Model] + concrete CRUD repos
```

Everything except `_mappers.py` and `shared/repository` is module-level procedural functions
taking `session` as the first argument. There is not one class in `app-service/src/services`.

Governing constraints already written down in the repo:

- `backend/docs/repository-boundaries.md`: repositories are **CRUD only** — accept `AsyncSession`,
  return ORM rows, **flush not commit**, no pydantic/cache imports. *"Keep large analytical queries
  in query/service modules. Do not hide CTE, window, leaderboard … queries behind CRUD repositories."*
- `backend/identity-service/src/services/*.py` is the repo's canonical OOP style and the template
  this refactor should follow:

```python
class AvatarService:
    def __init__(self, *, players: UserRepository = UserRepository()) -> None:
        self.players = players

    async def set(self, session: AsyncSession, ...) -> models.AuthUser: ...

avatars = AvatarService()          # module-level singleton, exported
```

  → constructor-injected collaborators, `session` per method, one exported singleton.
- `shared/rpc/crud.py` already provides `EntityConfig` + `CrudDispatcher` — a declarative CRUD
  engine with `EntityConfig.repo` as a `cached_property → BaseRepository(model)`. app-service wires
  it in `services/read_registry.py` (hero/map/gamemode/achievement get+list) and
  `services/workspace/registry.py` (workspace update/delete). **Extend it, never duplicate it.**

## 2. Defects found

### 2.1 Correctness — cache invalidation is a no-op (highest value)

`@cache(key="user_profile:{id}:{workspace_id}", prefix="backend:")` stores the key as
`backend:` + `:` + template → **`backend::user_profile:7:2`** (double colon).

`services/user_cache.py` and `services/tournament_events.py` build patterns as
`f"backend:{prefix}:*"` → `backend:user_profile:*`, which does **not** glob-match `backend::…`.

Measured with the installed cashews against a `mem://` backend:

```
'backend:user_profile:7:*'    deleted=0
'backend:user_profile:*'      deleted=0
'backend::user_profile:7:*'   deleted=1
```

Consequence: **every** `backend:`-prefixed cache entry survives every invalidation path —
`invalidate_user_caches(user_id)` (profile edit, merge, avatar, stream visibility),
`tournament_user_cache_patterns()` (tournament/match change), `backend:user_overview_order:*`.
Staleness is currently bounded only by TTL (300 s; 60 s for profile), so it reads as "eventually
fixes itself" instead of as a bug. `serve.py`'s startup `delete_match("backend:*")` still works
(the `*` swallows the extra colon), as does `achievement_rarity_map:*` — the one key that embeds
`backend:` in its own template instead of passing `prefix=`.

Affected keys: 12 of 13 (`user_maps`, `user_compare:v2`, `user_hero_compare:v2`, `user_profile`,
`user_tournaments`, `user_tournament_encounters`, `user_tournament_stats`, `user_heroes`,
`user_teammates`, `user_encounters`, `user_matches_summary`, `user_overview_order`).

Fix: drop `prefix="backend:"` from the decorators and put `backend:` in the key template — one
prefix source, existing patterns start matching, and the current tests
(`test_user_read_caches.py`, `test_user_compare_cache.py`) go from vacuous to meaningful because
they already seed/assert keys in the `backend:<prefix>:…` shape. Verified equivalent for plain
functions **and** bound methods.

### 2.2 Correctness — `user_tournament_encounters` is in no invalidation list

`user_cache.USER_CACHE_KEY_PREFIXES` lists 8 prefixes; the key defined at
`services/user/flows.py:1306` is not one of them and does not match any of them by prefix.
Independent of 2.1.

### 2.3 Repository boundary — 12 raw write sites in 6 files

| File | Sites | Model | Covered by |
|---|---|---|---|
| `services/admin/user.py:78,118` | add, delete | `User` | `UserRepository` (inherited) |
| `services/admin/user_csv.py:46,68` | add, `session.get` | `User` | `UserRepository` |
| `services/admin/user_merge.py:243,303` (+ `delete()`/`update()` at 510, 564, 553-556, 629-636, 682-685, 760-763) | add, delete, bulk | `UserMergeAudit`, `SocialAccount`, 8× reference tables | `SocialAccountRepository`; **new** `UserMergeAuditRepository` |
| `rpc/users_admin.py:448,465` | add, delete | `FavoritePlayer` | **new** `FavoritePlayerRepository` |
| `rpc/catalog_aliases.py:86,96,105` | `session.get`, `sa.update` | `Hero`/`Map`/`Gamemode`, `CatalogAliasMiss` | catalog repos; **new** `CatalogAliasMissRepository` + one update-by-filter method |
| `rpc/binary.py:53` | `session.get` | `Workspace` | `WorkspaceRepository` |

`services/admin/{hero,map,gamemode}.py` are already fully repository-backed — the target shape.

### 2.4 SQL in the transport layer

`rpc/audit.py` (filters, order-by, page + count queries, `list_page`), `rpc/catalog_aliases.py`
(`_list_misses` LEFT JOIN, `_attach_alias`, `_dismiss_miss`), `rpc/users_admin.py`
(`_resolve_my_player_id*`, `_propagate_avatar_to_auth_user`, favorites CRUD),
`rpc/binary.py` (slug lookup, match-log join), `rpc/{heroes,maps,gamemodes}.py` (each inlines a
near-identical lookup that bypasses its own flows/service). These four are de-facto un-split
services; favorites has no service module at all.

### 2.5 Dead code

- `services/user/service.py:2240-2480` — `_get_user_hero_compare_stats_legacy` +
  `_get_users_hero_compare_stats_legacy`, **239 lines, zero references** (v2 path replaced them).
- `src/core/metaclasses.py` — a `Singleton` metaclass, **zero users anywhere in `backend/`**.
- `services/gamemode/service.py` — docstring-only placeholder.
- `service.get_statistics_by_heroes_all_values_filtered` vs `…_all_values` — two 2-line wrappers
  over the same builder, differing only in `stats=None`.

### 2.6 Duplication

- `services/user/service.py:382-731` — seven `_overview_*_expr` scalar-subquery builders sharing an
  identical 30-line preamble; `avg_playoff_placement`/`avg_group_placement` differ by
  `Standing.buchholz.is_(None)` vs `.isnot(None)`; `maps_won`/`maps_lost` differ by one aggregate
  column. ~140 lines reducible to ~40 without changing generated SQL.
- `services/statistics/service.py` — `get_top_winrate_players` / `get_top_won_players` share the
  whole FROM/JOIN chain; `get_tournament_mvp_stat_for_user` / `get_tournament_mvp_stat_leaderboard`
  share ~90 % of a double-CTE body.
- `rpc/workspaces.py` — the same try/except-log-degrade block three times across `discord_*`.

### 2.7 Performance

| Site | Defect |
|---|---|
| `services/user/service.py:1783-1882` `get_overview_stats` | materialises **every** candidate user id into a Python list, then inlines it as `IN (…)` into 4 more statements; 5 sequential round trips. Should be one CTE/subquery + `COUNT`. |
| `services/dashboard/readiness.py` | 7 round trips per call, **4 avoidable** — `form_configured`, `registration_open`, `balance`, `draft_status` are independent single-value queries issued after an already-batched 6-subquery select. |
| `services/statistics/service.py` (×3) | separate `COUNT(*)` round trip next to each top-N page query; `count(*) OVER ()` collapses each pair. |
| `services/admin/user_csv.py:71` | `commit()` **per CSV row**; plus up to `1+len(smurfs)` sequential handle lookups and 4 sequential social upserts per row. |
| `services/admin/user_merge.py` (4 loops: 548, 610, 677, 739) | one `UPDATE` (sometimes preceded by an `EXISTS` scalar) **per row** instead of one bulk `UPDATE` per resolved target member. |
| `services/{hero,gamemode,map}/flows.py` `to_pydantic` | `async def` with **zero I/O**, unused `session`/`entities`, awaited inside per-row loops in `user/flows.py` (5 sites), `map/flows.py` (4), `achievements/flows_v2.py` (2), `gamemode/flows.py` (1). Coroutine allocation per row and a lying signature. |
| `services/user/flows.py:290-305` `get_overview` | 6 independent aggregate queries issued sequentially on one session. Real, but `AsyncSession` is not concurrency-safe — needs either fewer queries or the `dashboard/flows.py` multi-session pattern. Out of the safe set. |
| `services/dashboard/flows.py:10` | `get_dashboard_stats(session, …)` never uses `session` — it opens 3 fresh sessions for `asyncio.gather`. Dead parameter, misleading signature. |

### 2.8 Test-suite coupling (the real constraint)

~90 `patch.object` / `monkeypatch.setattr` sites across 14 test files target **module-level
functions and module-level singletons** by dotted path. Every one breaks when the target becomes a
class method. Highest-density seams:

- `tests/test_user_profile_flows.py` — 16 patches on `user_flows.{get,service.*,hero_flows.*,`
  `encounter_service.*,team_service.*,team_flows.*,_repositories.*,statistics_service.*}`
- `tests/test_user_merge_workspace_member.py` — 11 patches on `user_merge.*`, plus a 5-way
  composite stub of `preview_merge`/`_load_merge_context`/`apply_identity_selection`/
  `_reassign_reference`/`_repoint_player_workspace_members`
- `tests/test_workspace_service.py` — patches `workspace_service._user_repo`, `._workspace_repo`
- `tests/test_audit_workspace.py` — patches `workspaces_rpc._SF`, `binary_rpc._SF`
- `tests/test_division_rank_domain.py` — ~15 patches into `shared/` `division_grid_cache/_access`
- `tests/test_catalog_alias_admin.py` — asserts `hero_service.normalize_aliases is
  shared_aliases.normalize_aliases` **by identity**

Additionally, `tests/test_user_compare_performance_contract.py` and
`tests/test_users_overview_workspace_scope.py` pin **compiled SQL substrings** — CTE names
(`compare_candidates`, `compare_match_stats`, `compare_scoped_players`, `hero_stats_agg`,
`hero_stats_ranked`, `best_result_cte`), join placement, and `workspace_member.workspace_id = <id>`
verbatim. Any reorganisation must keep the generated SQL byte-identical unless the SQL change *is*
the point.

The `identity-service` pattern (class + exported module-level singleton) is what makes this
tractable: `patch.object(flows, "get")` becomes `patch.object(flows.users, "get")` — mechanical,
one line per site.

## 3. Target design

```
shared/repository/                    the three missing CRUD repos land here, not in app-service:
    catalog.py                        + CatalogAliasMissRepository (+ resolve_by_raw_name)
    identity.py                       + UserMergeAuditRepository
    preferences.py            NEW     + FavoritePlayerRepository

src/services/<domain>/
    service.py      →  class <Domain>Queries   + `queries = <Domain>Queries()`
                       analytical SQL only (CTE/window/aggregate), no pydantic, no cache
    flows.py        →  class <Domain>Service   + `<domain>s = <Domain>Service()`
                       constructor-injected queries/repos, owns @cache and pydantic mapping
    _mappers.py        pure sync ORM→DTO functions; the fake-async `to_pydantic` moves here
    _repositories.py→  class <Domain>…Queries  (analytical, so a query class, not a repository)

src/rpc/*.py                          zero SQL, zero commits; decode + gate + one service call
```

The models behind all three new repositories (`CatalogAliasMiss`, `UserMergeAudit`,
`FavoritePlayer`) live in `shared/models`, and `repository-boundaries.md` says shared CRUD
repositories live in `shared.repository` — so an app-service-local `src/repositories/` package
would have been a second home for the same concern. Not created.

Rules:
1. `session` stays a **method parameter** everywhere (matches `BaseRepository` and
   `identity-service`); query/service objects are stateless singletons — no per-request churn.
2. Collaborators are keyword-only constructor args with singleton defaults →
   `def __init__(self, *, queries: UserQueries = queries, players: UserRepository = UserRepository())`.
3. `@cache` moves onto methods unchanged (verified byte-identical key formation) and the
   `prefix=` kwarg is folded into the key template (§2.1).
4. Writes go through a repository; the **service** owns `commit()`. RPC handlers stop committing.
5. Analytical SQL never moves into a `BaseRepository` subclass (`repository-boundaries.md`).
6. The `user` domain's 3 418-line `service.py` splits by feature into
   `queries/{profile,overview,compare,encounters}.py` + shared scope predicates — the split is the
   point of the refactor, not incidental.
7. Every touched test patch site is updated in the same change. No compatibility shims, no
   module-level function aliases left behind.

## 4. Work packages

| # | Package | Verifiable here? |
|---|---|---|
| P1 | cache prefix fix + `user_tournament_encounters` prefix (§2.1, §2.2) | ✅ unit tests |
| P2 | dead code removal (§2.5) | ✅ suite + import |
| P3 | fake-async `to_pydantic` → sync, drop awaits in loops (§2.7) | ✅ suite |
| P4 | three repos in `shared.repository` + route all 12 raw writes (§2.3) | ✅ boundary test |
| P5 | extract rpc-embedded services: favorites, catalog aliases, audit, workspace binary (§2.4) | ✅ suite |
| P6 | OOP conversion, domain by domain, tests updated in lockstep (§3) | ✅ suite (331 non-DB tests) |
| P7 | de-duplicate `_overview_*_expr`, statistics query bodies (§2.6) — same generated SQL | ✅ compile-shape tests |
| P8 | `get_overview_stats` IN-list → subquery; readiness batching; `count(*) OVER ()`; `user_csv` single transaction; `user_merge` bulk UPDATE (§2.7) | ❌ **no runnable coverage without Postgres** |

P1–P7 are behaviour-preserving or unit-verifiable. P8 changes analytical SQL semantics on paths
whose only tests are the 172 skipped ones; it is in scope by explicit decision, mitigated by
moving method bodies verbatim everywhere else and by before/after compiled-SQL diffing for the
deduplication work.

## 5. Result (executed 2026-08-20)

| Gate | Before | After |
|---|---|---|
| `pytest app-service/tests` | 323 passed, **8 failed**, 172 skipped | **338 passed, 0 failed**, 172 skipped |
| app-service offenders in `test_repository_boundaries.py` | 6 files / 12 write sites | **0** |
| `ruff check app-service shared tests` | pass | pass |
| `lint-imports --config .importlinter` | **aborts: "section '' already exists"** — enforced nothing | **4 contracts kept, 0 broken** |
| literal RPC topics registered | 81 | **81, none added, none removed** |
| boot smoke (14 rpc modules + event consumer) | — | 93 subscribers, no duplicate topic |
| `backend/tests` + `shared/tests` | 3 failed (pre-existing) | same 3 (verified against a clean `HEAD` worktree) |

74 files, +7 040 / −10 887 lines.

### What landed

- **Query classes** — `UserProfileQueries`, `UserOverviewQueries`, `UserCompareQueries`,
  `UserEncounterQueries` (the 3 178-line `user/service.py` + 903-line `_repositories.py` became
  `user/queries/` with a shared `_scope.py`), `StatisticsQueries`, `DashboardQueries`,
  `ReadinessQueries`, `HeroQueries`, `MapQueries`, `AchievementQueries`, `CatalogAliasQueries`,
  `AuditLogQueries`.
- **Service classes** — `UserService`, `StatisticsService`, `DashboardService`, `ReadinessService`,
  `HeroService`, `MapService`, `GamemodeService`, `AchievementService`, `WorkspaceService`,
  `WorkspaceBinaryService`, `UserAdminService`, `UserMergeService`, `UserCsvImportService`,
  `HeroAdminService`, `MapAdminService`, `GamemodeAdminService`, `FavoritePlayerService`,
  `CatalogAliasService`, `AuditLogService`, `HeroStatsRefresher`. Each keyword-only
  constructor-injects public collaborators and exports one module-level singleton.
- **Repositories** — `CatalogAliasMissRepository`, `FavoritePlayerRepository`,
  `UserMergeAuditRepository` added to `shared.repository`; all 12 raw write sites routed through a
  repository; the `catalog_alias` dict-of-model-classes dispatch became a dict of repository
  instances.
- **RPC layer** — `users_admin.py`, `catalog_aliases.py`, `audit.py`, `binary.py`, `workspaces.py`,
  `heroes.py`, `maps.py`, `gamemodes.py` hold zero SQL and zero `session.commit()`; 21 commit sites
  moved into services.
- **Mappers** — `to_hero_read`, `to_map_read`, `to_gamemode_read`, `to_user_read` are now sync
  functions in `_mappers.py`; 12 awaits of a zero-I/O coroutine inside per-row loops are gone.
- **Deleted** — `core/metaclasses.py`, `services/gamemode/service.py`,
  `services/achievements/_repositories.py`, the two dead legacy hero-compare functions (239 lines),
  the duplicate `get_statistics_by_heroes_all_values_filtered`, and 5 stale allowlist entries.
  `rpc/_clients.py` moved to `core/clients.py` — a service was importing the transport package.

### Measured optimisation outcomes

| Path | Before | After |
|---|---|---|
| `compute_readiness` (both permission groups) | 7 round trips | **3** |
| `compute_readiness` (team scope only) | 6 | **2** |
| `get_top_champions` / `get_top_winrate_players` / `get_top_won_players` | 2 each | **1** each |
| `get_overview_stats` | 1 + 4, every candidate user id shipped as a literal `IN (…)` list | **5 statements over one `overview_candidates` CTE, zero id lists on the wire** |
| `user_csv` bulk import | one `commit()` per row | **one transaction** |
| `user_merge` repoint loops (4) | one `UPDATE` (+ sometimes an `EXISTS`) per row | **one set-based `UPDATE` per target member** |
| catalog/user `to_pydantic` in loops | one coroutine per row | **sync call** |

Equivalence checks: the seven `_overview_*_expr` builders were compiled across 5 filter
combinations plus the 4 `_overview_sort_expr` branches (49 statements) before deletion and after
de-duplication — 49/49 byte-identical. The eight non-window statistics queries likewise compile
byte-identically; the three top-N queries differ only by the authorised `count(*) OVER ()` column.

### Follow-ups not taken

- `get_overview` still issues 6 independent aggregate queries sequentially (§2.7). Fixing it needs
  either fewer queries or the multi-session fan-out `dashboard/flows.py` uses, because one
  `AsyncSession` cannot run concurrent statements. Out of this change's scope.
- 26 stale entries remain in `test_repository_boundaries.py::APPROVED_DIRECT_WRITE_FILES` for other
  services, and that test still fails repo-wide on ~48 non-app-service offenders.
- `tests/test_db_pool_config.py` and `tests/test_rank_snapshots.py` fail on `HEAD` and still do.

## 6. Correction pass

Two things the first pass got wrong, both because `shared/**` was read-only for the domain agents.

### 6.1 A module per one-line projection

`hero/_mappers.py` and `gamemode/_mappers.py` each held a single one-line function;
`map/_mappers.py` held four lines. They existed only because the projection has to be importable
from several domains and `src/schemas/**` is deliberately ORM-free (no schema module imports
`src.models`), so the schema could not host it.

The projection now lives as a `@staticmethod` on the service class that owns the read surface —
cross-domain callers already import the service singleton, so no new import edge and three fewer
modules:

| new | replaced |
|---|---|
| `HeroService.to_read(hero)` | `hero._mappers.to_hero_read` |
| `MapService.to_read(game_map, entities)` | `map._mappers.to_map_read` |
| `GamemodeService.to_read(gamemode)` | `gamemode._mappers.to_gamemode_read` |
| `UserService.to_read(user, entities, *, visible_only=False)` | `user._mappers.to_user_read` |

`user/_mappers.py` and `achievements/_mappers.py` survive — those are ~200 and ~100 lines of real
domain-specific projection, and after moving `to_user_read` out, `user/_mappers.py` is imported by
exactly one module, which is what the *"user/ private modules belong to user/"* import-linter
contract always intended.

Two edges deliberately **not** created: `MapService.to_read` keeps
`schemas.GamemodeRead(**game_map.gamemode.to_dict())` inline rather than calling
`GamemodeService.to_read` — one duplicated line beats a same-layer sibling import plus a permanent
contract exception. And `user/flows.py` imports `map.flows` **function-locally**: `map/flows.py`
already imports the `users` singleton at module level, so a top-level import is a runtime cycle.

### 6.2 Plain CRUD that should have gone to the shared repositories

`HeroRepository`, `MapRepository`, `GamemodeRepository`, `WorkspaceMemberRepository` and
`UserRoleRepository` already existed with adjacent functionality. Moved into them:

| moved to `shared.repository` | from |
|---|---|
| `HeroRepository.list_lookup` / `MapRepository.list_lookup` / `GamemodeRepository.list_lookup` | a `(id, name) ORDER BY name` projection sitting on three service classes |
| `WorkspaceMemberRepository.list_page` + `_members_filter` + `_primary_role_rank` + `ROLELESS_RANK` | `WorkspaceService.list_members_page` and two module helpers (~75 lines of hand-written paging SQL) |
| `UserRoleRepository.grant_missing_workspace_member_role` | the raw `INSERT … SELECT DISTINCT … NOT EXISTS` in `WorkspaceService.autofill_member_roles` |
| `UserRoleRepository.revoke_workspace_roles` | the bulk `DELETE FROM user_roles` in `WorkspaceService.remove_member` |
| `AuthUserRepository.get` (already existed) | `await session.get(models.AuthUser, …)` in `_resolve_player_id_for_auth_user` |

`HeroQueries` and `MapQueries` keep only genuinely analytical SQL (leaderboards, per-map playtime,
per-10 stat aggregates) — correct per `repository-boundaries.md`.

**Result: `app-service` now has zero entries in
`test_repository_boundaries.py::APPROVED_DIRECT_WRITE_FILES`** (it had one after the first pass, six
before it) and zero offenders. `WorkspaceService` gained two injected repositories
(`user_role_repo`, `auth_user_repo`) alongside the four it already had.

Gates after the correction: **338 passed, 0 failed, 172 skipped**; ruff clean; import-linter 4/4;
81 RPC topics unchanged; boot smoke 14 modules / 93 subscribers / no duplicates.

## 7. Collapsing the pointless half of the two-class split

The first pass applied `<Domain>Queries` + `<Domain>Service` mechanically to every domain. In half of
them the second class added nothing — `CatalogAliasService.list_misses` was a literal one-line
`return await self.queries.list_misses(session, params)`, and `MapQueries` was a whole module and
class for **one** method.

### Rule now applied

A domain keeps two classes only when the query class has a consumer **outside its own service**, or
when merging would produce a file over ~500 lines. Otherwise one class.

| domain | query class | consumers | verdict |
|---|---|---|---|
| `user` | 4 classes, ~3 800 ln | 1 | **split** — merging rebuilds the god module the refactor broke up |
| `hero` | `HeroQueries` 569 ln | 2 — `hero/flows.py`, `map/flows.py` | **split** — merging would force `map` to import the mapping layer to reach SQL |
| `statistics` | `StatisticsQueries` 526 ln | 2 — `statistics/flows.py`, `user/flows.py` | **split** — same |
| `achievements` | `AchievementQueries` 344 ln | 1 | **split** — merged file would be 591 ln |
| `map` | `MapQueries` 1 method | 1 | **merged** → `map/service.py` deleted |
| `dashboard` | `DashboardQueries` 3 methods | 1 | **merged** → `dashboard/service.py` deleted |
| `dashboard/readiness` | `ReadinessQueries` 2 methods | 1 | **merged** into `ReadinessService` |
| `admin/audit` | `AuditLogQueries` | 1 | **merged** into `AuditLogService` |
| `admin/catalog_aliases` | `CatalogAliasQueries` | 1 | **merged** into `CatalogAliasService` |
| `gamemode`, `workspace`, other `admin/*` | — | — | already one class |

Five classes and three modules gone. `StatisticsService`'s three methods were also three copies of
the same 12-line assembler differing only in the value rounding — collapsed onto one `_paginate`
helper (110 -> 89 lines), which is what makes a 3-method mapping service worth its own class instead
of being a wrapper.

Import-linter Contract 2 lost `src.services.map.service` and `src.services.dashboard.service` from
its forbidden list along with the modules.

Gates unchanged: **338 passed, 0 failed, 172 skipped**; ruff clean; import-linter 4/4; zero
app-service entries in `APPROVED_DIRECT_WRITE_FILES` and zero offenders.

### 7.1 `entities` token resolution moved into the repositories

`GamemodeService.get` and `MapService.get`/`get_by_name`/`get_all` each branched on an entity token
to pick between two named repository methods:

```python
game_map = await self.repo.get_with_gamemode(session, id) if "gamemode" in entities else await self.repo.get(session, id)
```

Which relation a token eager-loads is a property of the table, not of the request, and the
repositories already owned the loader options (`get_with_maps`, `get_with_gamemode`,
`all(with_maps=...)`). `services/user/queries/_scope.py` already resolved tokens to options below the
service layer, so the precedent existed. `GamemodeRepository`/`MapRepository` now expose
`load_options(entities)` plus `get_expanded(session, id, entities)`, and `all` / `get_by_name` take
`entities` instead of a boolean flag. Unknown tokens are ignored, so a caller passes its whole list
straight through and six `if "x" in entities` branches disappear.

Nothing else in the backend used the old signatures — verified before changing them; the only other
consumer of `MapRepository` is parser-service's alias resolution, which never passed the flag.

What this does **not** do is delete the service: the 404 and the ORM->pydantic mapping stay, and
`repository-boundaries.md` bars both from a repository (no HTTP errors, no pydantic), while
`src/schemas/**` imports no ORM model by design. `GamemodeService.get` is now four lines instead of
a branch, which is the honest floor for that method.

There is a route to deleting it entirely — `CrudDispatcher._get` already raises the 404 from
`cfg.not_found_detail` when the generic `cfg.repo.get` path returns None, and `cfg.serializer` could
carry the projection. It needs `EntityConfig` to pass request-scoped load options into that generic
path, i.e. a change to `shared/rpc/crud.py`, which `tournament-service/src/services/admin/registry.py`
relies on for 7 of its 10 entities. Cross-service engine surgery for one saved class: not taken.
