# Cross-workspace divisions on the game's ladder, and division bounds for the rank overview: release note

Division filters stay division numbers on the wire; the backend turns them into rank conditions. What changed is which
grid a number lives on in the all-workspaces read (`workspace_id=all`), and how fast that read resolves it.

Why: in the all-workspaces read every player row resolved its rank on its own tournament's grid through a correlated
subquery per row (tournament pin → workspace default → system grid, then the tier), so "Diamond" meant a different
rank band in every workspace and the cost grew with the player table. Compare read `div_min`/`div_max` on the system
grid instead, and the admin rank overview converted division chips to ranks in the browser, taking the lower-numbered
chip's floor as the rank minimum, which is backwards on a ladder numbered from the top.

## Backend

* **Canonical tier number** (`shared/division_grid.py`: `canonical_tier_number`, `canonical_division_number`,
  `stamp_canonical_numbers`): a tier's division on the game's native ladder (`ladder_grid(discipline)`). A tier with a
  native range lands on the ladder tier holding the range's midpoint; any other is placed proportionally by its
  position between its grid's first and last division. This is the mapping Overwatch analytics already used
  (`canonical.py` now calls it with `DEFAULT_GRID`), so ML features are unchanged.
* **Migration `canonical01`** (after `mixban02`): `division_grid_tier.canonical_number` (nullable; NULL for a game
  without a native ladder), backfilled per grid version. Every tier writer stamps it: create/update/clone version,
  cosmetic edits, workspace grid provisioning, portable and marketplace import.
* **All-workspaces reads** — users overview, overview stats, catalog, compare, character compare, character
  leaderboard: a row's division is its tier's `canonical_number`. Each tournament's effective grid version is resolved
  once in a `MATERIALIZED` CTE (`tournament_grid_versions`) that the player rows hash-join; a tournament with no grid
  at all reads its raw rank on the ladder. The `divisions` chips, `div_min`/`div_max`, `division_counts`, role badges
  and leaderboard `div` all come from the same expression, so a chip count always matches its filter. Responses carry
  `division_grid_version_id: null` and `division_grids: []`; `division`/`div` are nullable (a game without a native
  ladder). A division filter for such a game is a 422 `division_grid_required: ... has no native ladder for
  cross-workspace divisions`. Workspace-scoped reads are unchanged. Compare cache keys moved to `v4`.
* **Rank overview** `GET /api/v1/balancer/workspaces/{id}/ranks`: `div_min`/`div_max` (tier numbers on the workspace
  grid, 1 = top, inclusive) replace `rank_min`/`rank_max`; `div_min > div_max` is a 400 `invalid_filter`; both need
  `discipline` (422). Ranks below the grid floor count in the floor division, the top tier is open-ended.

## Frontend

* Users index, catalog and the character leaderboard in all-communities scope draw a row's crest and tier name from
  the game's native ladder (`metadata.native_ladder`), not the current workspace's grid. A null division shows the
  role glyph alone.
* Admin rank overview: the two "division from/to" selects are one `DivisionRangePicker` writing `div_min`/`div_max`;
  the browser no longer converts divisions to ranks.

## Known limit

* The proportional placement assumes a grid numbers its tiers from the top (1 = best), like every native ladder. A
  custom grid numbered bottom-up without native ranges would land mirrored on the ladder; give its tiers native ranges.

## Verification

* `canonical01` on a scratch database built from `initial_v6`: upgrade, downgrade, upgrade; two Overwatch grids seeded
  first (a 150–2000 scale, and one tier with a native range) backfilled to 1/23/45.
* Backend (local test Postgres): analytics-service suite (284 passed); shared tests (1782 passed); tournament-service
  `test_division_grid_{management,save,discipline,automap}.py` (87 passed); app-service
  `test_users_overview_db_values.py` (incl. the new two-scale all-workspaces test), `test_stats_reader_parity.py`,
  `test_users_all_workspaces_scope.py`, compare cache/scope tests; balancer `test_rank_overview.py` (20 passed).
  `ruff check`, `ruff format --check`, `lint-imports` (workspace and four services), `export_openapi_schemas.sh
  --check`, `check_rpc_docs.py`, `export_erd.py --check`.
* `EXPLAIN ANALYZE` of the all-workspaces `divisions` filter: one `CTE Scan` hashed into a `Hash Semi Join` on
  `player.tournament_id`; the tier lookup is the only per-row subplan.
* Frontend: `tsc --noEmit`; `vitest run` on users, character compare, admin ranks and i18n (159 passed).
