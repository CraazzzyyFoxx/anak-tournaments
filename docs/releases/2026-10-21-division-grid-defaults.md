# Default division grids per game and the divisions page: release note

Every enabled game with a native ladder now has a division grid of its own in every workspace, and
`/admin/settings/divisions` can create, rename, archive, restore and delete grids.

Why: the page had no way to create a grid since the divisions rebuild (`cd7a3a597`): `createDivisionGrid` was never
called. A game without a grid of its own (League of Legends and Deadlock everywhere) showed an empty page with no action.
Ranks still resolved through the game's in-code ladder, but the page, the editor and the General settings said otherwise
("Built-in Overwatch ladder", "OW ranks", "No division grid yet, so tournaments cannot be created").

## Backend

* **Provisioning** (`shared/services/division_grid/provisioning.py`, rules in `shared/domain/division_grid_defaults.py`):
  a workspace with no grid of an enabled game (archived ones count) gets one: slug `{game}-default` (`-2`, `-3`… when
  taken), named after the game, with a published v1 that is the game's native ladder, one division per ladder rank
  (Overwatch 45, LoL 31, Deadlock 66). It runs when a workspace is created and when a game is enabled
  (`WorkspaceService.create` / `.update`).
* **Activation of that v1** (`default_grid_plan`). The workspace's explicit choice for the game is never overridden.
  Otherwise v1 is activated when the game has no system grid: its tournaments already read the native ladder, which v1
  is, so no division is renumbered. A game that resolves through a system grid (the Overwatch "System Default") moves
  onto its own grid only when it is new to the workspace (its creation, the game just enabled) and has no tournaments.
  The backfill never moves a game already running off a system grid.
* **Migration `defgrid01`** (after `owmapdrop01`) backfills every workspace with the same rules. Downgrade is a no-op:
  the grids are the workspace's own data from then on. The migration cannot clear Redis, so a workspace that changes
  its default can serve the old resolution until the cache entry expires; v1 equals that resolution for LoL and
  Deadlock.
* **Create grid** `POST /api/v1/division-grids/by-workspace/{workspace_id}`: `slug` is optional (derived as
  `{game}-grid`, `-2`, …). New `from_version_id`: v1 becomes a published copy of that version (tiers and label). It
  must be this workspace's version or a system grid's (400 otherwise), of the same game (422
  `division_grid_discipline_mismatch`), and published (409). Creating a grid never activates anything.
* **Grid list** `GET /api/v1/division-grids/by-workspace/{workspace_id}`: every grid carries `tournament_count`,
  the tournaments pinned to any of its versions (one grouped count). Other grid payloads send `null`.
* `seed_default_grid_version` and `ladder_tiers_write` are removed; every seeded grid goes through the shared creator.

## Frontend

* **All games**: a summary row per enabled game with the grid in force (or the built-in ladder), its division count
  and ladder bar; a row opens that game.
* **One game**: the in-force card names the grid and version (`League of Legends · v1`) and offers exactly one next
  step: open the draft, activate a ready version, start a draft, or "Create {game} grid" for a game without one. The
  version history no longer repeats it.
* **New grid** (page header, with the **Import** menu beside it): name, and the game under all games. When the
  version in force differs from the built-in ladder, the grid can start as its copy or from the ladder. Creating opens
  the new grid; nothing is activated.
* **Grid menu** beside the grid's name: new draft from the newest version or from the ladder, rename, export JSON,
  archive or restore, delete. The grid in force cannot be archived or deleted; the menu says why. A grid tournaments
  are pinned to is deleted only through "Detach and delete", which names the count and asks for the grid's name.
  Divisions are computed when ranks are read, so the detached tournaments simply show their ranks on the game's grid
  in force; nothing is recalculated.
* Game-aware copy: the 31 strings that said "OW"/"Overwatch" in the page, the editor and the import wizard name the
  game ("LoL ranks", "Deadlock ladder") or say "ladder". RU uses «шкала» for the grid, per the i18n glossary.
* General settings warn about a missing grid only for a game with no native ladder.
* The version list lays its actions under a row unless the list itself is wide (container query): in the two-column
  layout a blocked "Activate" squeezed the version's name and caption to a sliver.

## Verification

* Backend (cwd `backend`, local test Postgres): `uv run pytest shared/tests/test_division_grid_defaults.py
  shared/tests/test_division_grid_discipline_db.py` (17 passed), `app-service/tests/test_workspace_service.py
  app-service/tests/test_workspace_self_service_create.py` (34 passed), tournament-service
  `test_division_grid_{discipline,management,save,automap}.py` (81 passed); `lint.sh`, `export_openapi_schemas.sh
  --check`, `check_rpc_docs.py`, `lint-imports`; `alembic heads` → `defgrid01`.
* `defgrid01` on a scratch copy of the test database, stamped at `owmapdrop01`, with a system Overwatch grid, a
  workspace with Overwatch and LoL and no tournaments, and one with Overwatch, LoL, Deadlock and an Overwatch
  tournament: both got `lol-default` (31 tiers) and the second `deadlock-default` (66) as their defaults;
  `overwatch-default` (45) was created in both and activated in neither.
* Frontend: `tsc --noEmit`; `eslint` on the divisions code; `vitest run src/app/admin/settings
  src/components/admin/workspace-settings src/components/kit src/i18n src/app/(site)/docs src/disciplines/overwatch
  src/lib/divisions` (377 passed).
* A local `next dev` against the dev site: the summary, a LoL and a Deadlock game without a grid of their own,
  Overwatch with two versions, the grid menu and the New grid dialog, at 390, 768, 1024 and 1440 px, with no
  horizontal scroll.
