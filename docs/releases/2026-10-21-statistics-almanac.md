# Statistics almanac: release note

`/statistics` is now an all-time almanac: who is best (players table, records) and what is played (characters, maps).
Every section loads, fails and empties on its own. Trend charts and the three leaderboard cards are gone.

## Behaviour

* **Hero figures.** Tournaments, players, series, maps, hours played and tournament days from
  `/tournaments/statistics/overall`.
* **Игроки.** One table: titles, tournaments, maps W–L, win rate. Sort by any column (`?sort=`, default titles), nick
  search (`?q=`), 20 rows per page (`?page=`). Competition ranks (1, 2, 2, 4) over the whole population, so a search
  never renumbers. Sorting by win rate keeps players with more than 3 tournaments; elsewhere their win rate is greyed.
* **Рекорды.** Longest series win streak, biggest upset (weaker roster by avg SR inside one tournament, ranked by
  relative gap), underdog champion (champion's SR rank among its tournament's rated teams), closest final (captain
  closeness). With a game chosen, single-map log records too: hero damage, healing, eliminations, damage blocked, solo
  kills, most map MVPs, longest map. A record with no data is absent.
* **Персонажи** (one game): playtime share per character grouped by role; rows open the heroes-compare leaderboard.
* **Карты** (one game): games per map grouped by mode, share within the mode, average parsed length. A series counts
  its confirmed games with a map, else its parsed maps.
* A link to `/encounters` replaces series analytics on this page.

## Wire

* New `GET /api/v1/statistics/players` (`rpc.app.statistics.players`), `GET /api/v1/statistics/records`
  (`rpc.app.statistics.records`) and `GET /api/v1/statistics/{discipline}/maps` (`rpc.app.statistics.maps`): public,
  60 s cache, optional `workspace_id`; unknown game → 404 `discipline_not_installed`.
* **Removed** `GET /api/v1/statistics/won-maps` (`rpc.app.statistics.won_maps`).
* `encounter_seats`: the seat subqueries filter on a bare `active`, so Postgres uses the partial index (players table
  and win streak 10.1 s → 0.18 s on the dev dataset; the win-rate board and profile reads share the gain).
* Migration `statrec01`: partial index `stats.ix_fact_stat_value_total (stat_id, value)` over player totals. The
  single-map records are one backward index probe per stat (~1 s → ~10 ms on the dev dataset).
* Fix: `GET /api/v1/users/overview/stats` timed out (500 after 30 s) on every scope. Its "with logs" count, and the
  users list `has_logs` filter, probed `player_facts` per user with no usable member index; they now probe player
  totals through `ix_fact_member_stat_total` (47 s → 13 ms on the dev dataset).

## Verification

`pytest tests/test_statistics_almanac_db.py tests/api/routes/test_statistics.py tests/test_cross_game_reads.py
tests/test_stats_reader_parity.py tests/test_user_reads_one_game.py tests/test_users_overview_db_values.py
tests/test_rpc_route_parity.py` against the test Postgres, `statrec01` downgrade/upgrade round trip (`test_get_champions`
needs champion rows the test database does not have); `go test ./...` for the gateway;
`next build`, `eslint`, `vitest` for the statistics page. Browser check of `/statistics` and
`/statistics?discipline=overwatch` at 1440, 1024, 768 and 390 px against the dev database (read-only) through the
working-tree app-service: sort, search, pagination and every section with real data.
