# Game scope (community × game): release note

The site and the admin are no longer limited to one game. One pill, **"Community · Game"**, replaces the community
switcher in the site header and joins the admin top bar; it narrows what the viewer sees to all games or one game.
List pages read every game under "all games" (with a game mark per row and an "Игра" column in admin tables); pages
that are one-game by nature (compare, catalogs, per-game settings) ask for a game locally with tabs, without changing
the scope. Spec: `docs/superpowers/specs/2026-10-20-game-scope-design.md`; plan:
`docs/superpowers/plans/2026-10-20-game-scope.md`. **One database migration** ships: `regtpl01` (after
`achievement06`), giving every registration form template its game.

*Admin parts superseded on 2026-10-20 by `docs/releases/2026-10-20-admin-game-filter.md`: no pill in the admin, the
community switcher is back in the account menu, the game is a per-list filter chip and the admin ignores the saved
scope.*

Deploy **all images from one SHA** (app, tournament, balancer, stats, analytics, stream, identity, gateway, frontend):
the frontend omits `discipline` under "all games", which the previous backends reject as a missing game.

## 1. What changed on the wire

* **Game list in area order.** `GET /api/v1/disciplines?workspace_id=<id>` lists the community's enabled games in its
  `disciplines_enabled` order, then the other installed games in installed order; `workspace_id=all` keeps installed
  order. This order is the pill's game order, "the first enabled game" of every default and every tie-break (spec §2).
* **Game marks.** `DisciplineSpec` gains `short_name` and `icon`; `DisciplineDescriptor` exposes `short_name`
  (falls back to the name) and `icon` (null today: the mark renders a monogram).
* **Optional `discipline` on lists** (absent = every game of the requested workspace scope; an unknown code keeps
  each service's existing error): leaderboards `GET /statistics/champion|winrate|won-maps`, admin achievement rules,
  admin sub-roles, admin matches (both views, newly filtered server-side), the teams list, the profile tournaments and
  encounters tabs (every row carries `discipline`; `mvp1` without a game is a 422), and the registration template list.
  Gateway route specs forward `discipline` where they did not.
* **No-game reads skip the division grid.** `resolve_workspace_context(discipline=None)` returns a context without a
  grid: a read without a game never takes the first game's grid and never fails with `division_grid_required`. A game
  without a grid still lists its rank rows (`division: null`) and still gets its profile game card (without roles).
* **Users index without a game.** `GET /users/overview`, `/overview/stats`, `/overview/catalog`: cross-game aggregates;
  rows and cards keep their shape with `roles: []`, `top_characters: []`, and every row lists `disciplines` (games
  played, both modes); stats return `role_counts: {}`, `flex_count: 0`, `flex_declared_count: 0`,
  `division_counts: []`. `role` and `divisions` without a game are a 422 (`<param> requires discipline`).
* **Profile without a game.** `GET /users/{id}/profile`: cross-game header aggregates, `roles: []`,
  `character_statistics: []`, `most_played_character: null`, `characters_count: 0`, plus
  `games: [{discipline, roles, tournaments_count, tournaments_won}]`, most tournaments first, ties in installed order
  (empty under a game). `tournaments[]` entries carry `discipline`.
* **Admin rank overview without a game.** `GET /balancer/workspaces/{ws}/ranks`: the union over the workspace's
  enabled games, every row tagged `discipline`; a game without a grid lists its rows with `division: null`. `role`,
  `rank_min`, `rank_max` and `sort=rank_value|division` without a game are a 422. Absent no longer means "the first
  enabled game".
* **Mix stats.** `GET /balancer/workspaces/{ws}/custom-games/stats`: `by_role` is `null` without a game (role codes of
  different games are different roles); no UI renders it.
* **Registration form templates** are owned by a game: `RegistrationFormTemplateRead.discipline`; create requires an
  enabled game (422 `discipline_required` without one, 422 `discipline_not_enabled` for a game the workspace does not
  run); changing it is 409 `template_discipline_immutable`; `?discipline=` filters the list; "save as template" takes
  the tournament's game; applying another game's template is 409 `template_discipline_mismatch`.

## 2. Behaviour

* **Scope.** Cookie `owt-discipline` (absent = all games) and `owt-last-game`, one value for the site and the admin,
  written only by the pill (scope + last game + URL) and by local tabs (last game, plus the URL on single and platform
  pages and for game blocks on `none` pages). Landing never rewrites the URL; links no longer carry the game;
  `?discipline=all` from old links reads as "no parameter"; an explicit unknown or disabled code shows the unavailable
  state, never a silent correction.
* **Enabled games and their order.** Owners switch games on and drag their priority in General (`disciplines_enabled`
  is `workspace.update`); a save there re-reads the community's game list, so the pill, local tabs and every "first
  enabled game" default follow the new set and order at once.
* **Page classes** (one route table, `pageClassOf`) follow the spec §5 table; no interim single page remains. Multi:
  home, `/tournaments`, `/balancer/mix`, `/encounters`, `/achievements`, `/statistics`, `/users`, the profile, the
  community page and the multi admin lists (tournaments, teams, matches, ranks, achievements, division grids index,
  registration forms, sub-roles). Single: `/users/compare`, `/users/heroes-compare`. Owner: entity pages (including
  `/admin/teams/[id]`, `/achievements/[id]`, `/admin/achievements/[id]`, a division grid version) and in-page editors
  (a selected template or sub-role) — the pill shows the owner's game, locked. Platform: game content, collectors, the
  other Platform-group pages and account mix preferences — own tabs, no pill. None: dashboard, people (list and person
  page), members, other settings, `/admin/tournaments/new` (it has its own game field) — pill dimmed.
* **Game-bound URL params.** Each page registers its game-bound params (`useGameBoundParams`); a game pick in the pill
  drops them together with `page`. Under all games a game-bound filter value never reaches a request, whether it came
  from the landing URL, a saved view or the way out of an invalid game.
* **Multi under "all games".** Game-bound filters (roles, divisions, rank range, maps, tournament/stage pickers) give
  way to a hint chip that opens the pill. Bulk per-game admin actions are disabled with "Выберите игру в фильтре".
  Creation forms carry a "Игра" field (scope's game, else last game, else the first enabled). Phone cards of every
  multi admin table (`/admin/tournaments`, `/admin/teams`, both `/admin/matches` views, `/admin/ranks`,
  `/admin/achievements`) name the game under all games through their own card renderer, whatever column order was
  saved.
* **Game blocks.** A game-bound block on a multi page (division trend, community division/character blocks, the
  profile's per-game tabs) gets local tabs under all games that write only the last game; while a valid explicit
  `?discipline=` fixes the page's game it shows that game with no tabs. A block on a `none` page (the person page's
  rank table and rank history) behaves as a platform block with its own tabs: explicit game, else the scope's game,
  else the last game, else the first; a tab pick writes `?discipline=`, so both blocks agree.
* **Profile.** A cross-game header, one card per game played (most tournaments first, ties in the area's order; a
  card's mark narrows the scope), "Турниры", "Матчи", "Ачивки" across games with marks (league history groups never
  merge two games); every other tab reads one game chosen by local tabs (last game if played, else the main game) from
  that game's own profile. Under a game: that game's card, from the profile bound to it; a player who never played it
  gets "{player} не играл в {game}" with "Показать все игры". A game change on the profile (its tabs or the pill) drops
  the tournament it pinned (`tournamentId`, `achievementTournamentId`, `selectedTournamentId`).
* A community with one enabled game behaves as that game everywhere: no marks, no column, no tabs.

## 3. Migration `regtpl01`

Adds `balancer.registration_form_template.discipline` (FK `catalog.discipline.code`,
`fk_registration_form_template_discipline`), backfills it, then sets NOT NULL. Backfill: the game whose identity
provider is the provider of the template's **required** game-identity question; none or more than one → the
workspace's first enabled game. The provider → game map is frozen in the revision. `downgrade` drops the column.
Pinned by `backend/tests/test_regtpl01_upgrade.py`.

## 4. Rollout

1. Build every image from one SHA.
2. Run `alembic upgrade head` (applies `regtpl01`).
3. Roll every service and the gateway, then the frontend. There is no old-wire compatibility in either direction.
4. Smoke: the pill on the site, the admin, a tenant host and mobile; `/tournaments` and `/users/compare` under all and
   under a game; an owner page's lock; `/admin/ranks` under all.

## 5. Verification

Final matrix on the merged head (`13dec0e81`: develop `5ff718ff0` merged in as `d246e7d71`):

* backend (cwd `backend`): `uv run bash scripts/lint.sh`; `bash scripts/export_openapi_schemas.sh --check`;
  `uv run python scripts/export_ow_ladder.py --check`; `uv run python scripts/export_erd.py --check`;
  `uv run python scripts/check_rpc_docs.py`; `uv run lint-imports --config .importlinter`;
  `uv run python scripts/check_discipline_literals.py`; `uv run pytest <svc>/tests -q` for shared, app-service,
  stats-service, balancer-service, tournament-service, analytics-service, identity-service, discord-service,
  stream-service; `uv run pytest tests -q`.
* gateway (cwd `gateway`): `go test ./...`.
* frontend (cwd `frontend`): `bun run typecheck`, `bun run lint`, `bun run lint:zones`, `bunx vitest run`,
  `bun run build`.
* browser (spec §11): a throwaway local stack (own Postgres database, Redis, S3 and RabbitMQ; `next dev --webpack`)
  instead of `make dev-up`; the pill, tenant, mobile, multi, single and owner checks at 1440 px and 375 px.
  Screenshots were kept locally, not committed.

Results:

* backend gates: `lint.sh`, OpenAPI, ERD, RPC docs, import-linter and `check_discipline_literals.py` ok.
  `export_ow_ladder.py --check` reports a byte mismatch only (CRLF checkout on Windows; regenerating gives no content
  diff).
* backend shared: 1689 passed, 12 skipped.
* backend app-service: 883 passed, 3 skipped, 95 failed — the same 95 fail before the merge and on develop's own
  fixtures: seeded user ids 79/461/583/599 absent from the ephemeral test database, searches for seeded names,
  `models.Player.div` in `test_user.py`, `test_get_champions`, `test_achievements.py`.
* backend stats-service: 533 passed, 34 skipped, 2 failed — `test_stats_derived_parity.py` and
  `test_stats_native_isolation.py` expect no active impact baseline and find one left by an earlier test in the shared
  database; both pass alone.
* backend balancer-service: 1060 passed, 3 skipped, 1 failed (pre-existing
  `test_admin_summary.py::TournamentSummaryRpcTests::test_summary_returns_hidden_tournament_for_team_read`).
* backend tournament-service: 1914 passed, 29 skipped.
* backend analytics-service: 287 passed; discord-service: 122 passed; stream-service: 107 passed.
* backend identity-service: 320 passed, 1 failed, 5 errors — pre-existing (the service is unchanged by this branch;
  same result alone).
* backend root `tests`: on the merged head only the files develop changed and the migration-chain tests
  (`test_messaging_config.py`, `test_outbox.py`, `test_repository_boundaries.py`, `test_regtpl01_upgrade.py`,
  `test_achievement06_upgrade.py`): 15 passed. The full root suite before the merge (without the two stats01 receipt
  files, which stall for 45+ minutes): 568 passed, 2 failed — `test_enclayer01_upgrade.py` (pre-existing) and
  `test_repository_boundaries.py` (fixed in `2c8329aff`).
* gateway: ok.
* frontend: typecheck ok; lint 0 errors (46 warnings); lint:zones: develop's Z4 finding only; vitest 475 files /
  4020 tests, 1 failed (`nativeMatch.behavior.test.tsx`, a timeout under load; 11/11 alone); `bun run build`
  (Turbopack) refuses this worktree's linked `node_modules`, `bunx next build --webpack` compiles (75 static pages).

Browser matrix:

* a. site pill, `/tournaments` — 1440 PASS, 375 PASS.
* b. admin pill, `/admin`, `/admin/tournaments`, `/admin/content/heroes` — 1440 PASS, 375 PASS.
* c. tenant host, `/tournaments` on a two-game and a one-game tenant — 1440 PASS, 375 PASS.
* d. mobile trigger and popover, `/tournaments` — 375 PASS (desktop counterpart 1440 PASS).
* e. multi `/tournaments`: saved game, all games, explicit `?discipline=lol` — 1440 PASS, 375 PASS.
* f. single `/users/compare` — 1440 PASS, 375 PASS; the hydration error under all games (D1) was fixed in
  `289b64cb4` and re-checked PASS.
* g. owner `/tournaments/<slug>` of another game: locked pill, saved scope unchanged — 1440 PASS, 375 PASS.
* h. admin multi lists `/admin/ranks`, `/admin/tournaments` — 1440 PASS, 375 PASS; a first visit without a community
  cookie listed every community's rows (D2), fixed in `289b64cb4`, re-checked PASS on `/admin/tournaments` and
  `/admin/teams`.
* profile `/users/<slug>` under all games — the game cards' and role split's hydration errors (D3, D4) were fixed in
  `77f5995f2`, re-checked PASS at 1440 and 375; all six tabs PASS.
* final-review fixes — streamed `/encounters` rows name their game in the server HTML; a pill pick drops the
  profile's `achievementTournamentId`; achievement-rule and sub-role creation default to the saved scope's game under
  `?discipline=lol`; the profile's last-tournament card names its role on first paint: PASS.
* profile game tab after pinning a tournament (D5, fixed in `57e9dead6`) and pill picks on server-rendered pages
  (`/users/<slug>`, `/statistics`, `/workspace/<slug>`, `/`, `/tournaments`; D6, fixed in `13dec0e81`) render the new
  scope without a reload: PASS on the merged head.
* develop's features on the merged head — reordering or enabling games in General updates both pills and the local
  tabs without a reload; `/balancer/mix` marks each mix's game; a mix page locks the pill to its game: PASS.
* hydration and console sweep — 22 site URLs and 9 admin URLs on the merged head: no hydration error; the only
  console errors are 404s for missing seed art.
