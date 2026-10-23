# Admin game filter: release note

The admin no longer follows the site's "Community · Game" scope. The pill is gone from the admin top bar; the
community switcher is back in the account menu (sidebar footer, "Воркспейс" section) and lists communities only. The
game is an ordinary filter chip on each admin list, like its other filters. Frontend only: no backend, wire or
migration change. Supersedes the admin parts of `docs/releases/2026-10-20-game-scope.md`.

## Behaviour

* **No shared scope.** The admin never reads `owt-discipline` or `owt-last-game`, and nothing in the admin writes them
  (`useGameScope` on `/admin*`). A game picked on the site no longer narrows the admin, and the other way round. The
  site pill is unchanged.
* **Community switch** (account menu) drops `?discipline=` when the new community does not run that game.
* **"Игра" chip** (`components/admin/game-filter.tsx`, key `discipline`) in the `FilterBar` of `/admin/tournaments`,
  `/admin/teams`, `/admin/matches` (encounters and parsed views), `/admin/ranks`, `/admin/achievements`,
  `/admin/settings/divisions`, `/admin/settings/sub-roles` and `/admin/settings/registration-forms`. Absent = every
  game, with the "Игра" column; absent too where the community runs one game.
* **Filters that need one game.** The tournament chip is always offered: without a game it lists every tournament
  with its game mark. Stage and group follow the tournament. The map chip (parsed view) needs a game from the chip or
  from the selected tournament; role and rank range (ranks) need the chip. Rank and division sorts stay disabled
  without a game. `GameFilterHint` is no longer used in the admin.
* **A game change** drops `page`, the map, role, rank range and a rank sort; the tournament (with stage and group) and a
  pinned division grid only when they belong to another game. Sub-roles drop `role` unless a sub-role is open.
  Removing the chip keeps the tournament.
* **Per-game actions** on `/admin/achievements` stay disabled without a game: "Выберите игру в фильтре".
* **Creation default** (tournament, achievement rule, sub-role, registration template): the chip's game, else the
  community's first enabled game. "Создать турнир" carries the list's `?discipline=`.
* **Platform pages** (game content, rank collector, a person's rank blocks) keep their own tabs: `?discipline=`, else
  the first game.
* **Owner pages** show no game lock any more; they read the game from the owner as before.

## Verification

`bun run typecheck`, `bun run lint`, `bun run lint:zones`, `bunx vitest run` (cwd `frontend`); browser check of the
account-menu switcher and the chip on `/admin/teams` and `/admin/matches`.
