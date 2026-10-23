# Hero leaderboard: release note

`/users/heroes-compare` answers "who plays it best?" on a ranked board instead of one endless table: a compact header,
heroes picked from a portrait rail, a hero card and a top-10 chart over a heat-map table, and a sample floor that keeps
one-game averages off the top.

## Behaviour

* **Game.** The page has no game tabs of its own: it reads the game of the site's game switcher. Under "all games" it
  shows the last game played (else the community's first) and a chip naming it ("Overwatch · switch the game in the
  header") that opens the switcher.
* **Header.** Compact page hero; its right side holds the controls: the game chip, the hero picker (long rosters only),
  the tournament and the sample floor.
* **Hero rail.** A game with up to 60 characters shows every portrait, one row per class in the game's declared order;
  a class that is a rated role wears its glyph and name. A longer roster (League of Legends) keeps the searchable
  picker. On a phone each row scrolls sideways.
* **Hero card.** Portrait, class, and four figures: players ranked, hours on the hero (every player), the median games
  per player, best K/D with its player. "Rank by" chips (the table's five columns) re-order the table and the chart.
* **Top 10.** The ten best players by the ordering stat, each bar the value as a share of the leader's (turned around
  for a lower-is-better stat), with their games.
* **Sample floor.** `?min_games=` (1, 3, 5, 10, 20) leaves players with fewer games on the hero off the board, the card
  and the chart. Default 5 for all tournaments, 1 for one tournament. The footer counts the players left off and
  "Show everyone" sets the floor to 1.
* **Table.** Default order is the class's signature stat (healing for support, damage blocked for tank, damage
  otherwise; `?sort=` still wins). Each cell is tinted by the share of ranked players it beats (better than 50, 75,
  90%; the bottom tenth fades), with a legend; lower-is-better columns count the other way. A Games column (games and
  time on the hero); each player wears their division crest, its tier name in the tooltip; the team stays in the row
  tooltip. Podium ranks are medal chips. "Find a player" filters by name (a match keeps its rank on the whole board),
  25 rows then "Show 25 more", and "Reset columns" sit in the table's head.
* **Phone.** The rank and player columns stay put while the stat columns scroll.

## Wire

* `GET /api/v1/statistics/{discipline}/characters/{entity_id}/leaderboard`: every row gains
  `division_grid_version_id`, the grid its `div` is a number on (the request's workspace grid in a scoped read, the
  player's latest tournament grid with `workspace_id=all`), and the page gains `division_grids`, every referenced grid
  once (`CharacterLeaderboardResponse`). A row's division and its grid are now resolved on the player's latest row only.

## Fixes

* Tank and damage heroes get their own default columns (the catalog's class is lowercase; the lookup was not).
* Weapon and crit accuracy print the API's fraction as percent points (`0.32` → `32.0%`, was `0.3%`).
* The game tabs scroll inside a phone's width instead of spilling past its left edge (`/users/compare`).
* In the all-communities view a player's division used to read on the viewer's community grid; it now reads on the
  grid it was given in.

## Verification

Backend: `ruff`, the leaderboard tests of `app-service/tests/test_stats_reader_parity.py` (frozen capture, thresholds,
foreign game, and the grid each row names in both scopes) against fresh parity databases on the ephemeral test
PostgreSQL, `export_openapi_schemas.sh` and `gen:api`. Frontend: `vitest` (heroes-compare host, Overwatch character
module, workspace controls, registry), `tsc --noEmit`, `eslint`, `lint:zones`, `lint:design` (no findings in the
changed files). Browser check of `/users/heroes-compare` at 1440 and 390 px against the dev API.
