# Hero leaderboard: release note

`/users/heroes-compare` answers "who plays it best?" on a ranked board instead of one endless table: a compact header,
heroes picked from a portrait rail, a sample floor that keeps one-game averages off the top, and a monochrome table.

## Behaviour

* **Header.** Compact page hero. Three figures over the ranked players: players ranked, the class's top signature stat
  per 10 (healing for support, damage blocked for tank, damage otherwise) with its player, best K/D with its player.
* **Hero rail.** A game with up to 60 characters shows every portrait, one row per class in the game's declared order;
  a class that is a rated role wears its glyph and name. A longer roster (League of Legends) keeps the searchable
  picker in the toolbar. On a phone each row scrolls sideways.
* **Sample floor.** `?min_games=` (1, 3, 5, 10, 20) leaves players with fewer games on the hero off the board and the
  header figures. Default 5 for all tournaments, 1 for one tournament. The footer counts the players left off and
  "Show everyone" sets the floor to 1.
* **Board.** Default order is the class's signature stat (`?sort=` still wins). New Games column (games and time on the
  hero) and a division badge per player; the team dots and legend are gone (the team stays in the row tooltip). Bars
  show the share of ranked players a value beats, so a longer bar is better in every column, "lower is better" ones
  included; only the ordering column is in the accent. Podium ranks are medal chips.
* **Search and paging.** "Find a player" filters the board by name; a match keeps its rank on the whole board.
  25 rows, then "Show 25 more".
* **Phone.** The rank and player columns stay put while the stat columns scroll.

## Fixes

* A long battletag in the header no longer runs over the next figure.
* Tank and damage heroes get their own default columns (the catalog's class is lowercase; the lookup was not).
* Weapon and crit accuracy print the API's fraction as percent points (`0.32` → `32.0%`, was `0.3%`).
* The game tabs scroll inside a phone's width instead of spilling past its left edge (also `/users/compare`).

## Verification

`vitest` (heroes-compare host, Overwatch character module, workspace controls), `tsc --noEmit`, `eslint`, `lint:zones`,
`lint:design` (no findings in the changed files). Browser check of `/users/heroes-compare` at 1440 and 390 px against
the dev API: Ana and Reinhardt defaults, search, show more, show everyone, a single tournament's floor, the Deadlock
rail and the League of Legends picker, English and Russian.
