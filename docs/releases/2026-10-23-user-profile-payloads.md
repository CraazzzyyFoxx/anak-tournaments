# User profile payloads: release note

The player profile (`/users/[slug]`) shipped data its UI never reads. The profile response was about 0.25 MB, the
tournament history 0.5–0.65 MB, and each encounters page 0.5–2 MB. Most of those bytes were:

* a full division grid on every tournament card, about 3.6 KB per copy;
* every member's 48 whole-match facts on every match, while the badge ranks one stat;
* a full catalog entity for each roster character, while the strip draws a name and an image.

The wire now carries what the page renders. These are breaking changes for HTTP clients of the routes below.

## Changed responses

* **`GET /api/v1/users/{id}/profile`** (`UserProfile`)
  * `tournaments[].division_grid_version` is removed. A card is now `{id, name, discipline, is_league, is_finished, status}`.
  * `games[].roles[]` is now `UserRoleSummary`: `{role, tournaments, maps_won, maps, division}`, without `division_grid_version`.
  * `roles[]` (`UserRole`) is unchanged and keeps its `division_grid_version`: the crest is drawn on it.
* **`GET /api/v1/users/{id}/tournaments`**
  * Before: `UserTournament[]`. After: `UserTournamentList {results: UserTournament[], division_grid_versions: DivisionGridVersionRead[]}`.
  * A row's `division_grid_version` is replaced by `division_grid_version_id` (nullable). Each version appears once in `division_grid_versions`, ordered by id. Resolve a row's grid with `division_grid_versions.find(v => v.id === row.division_grid_version_id)`.
  * `encounters` (always `[]`) is removed.
  * `players[].characters[]` is now `CatalogEntityRef {id, slug, name, image_path}` instead of the full `CatalogEntityRead`.
* **`GET /api/v1/users/{id}/encounters` and `GET /api/v1/users/{id}/tournaments/{tid}/encounters`**
  * `matches[].member_totals` ships only the stats in the game's `DisciplineSpec.member_total_stats`. That is the whole-match totals the match renderer ranks the viewer against.
  * For Overwatch that is `overperformance_score`, and the badge rule is unchanged. Games that declare none get `[]`.
  * The rows are filtered in SQL: the other facts are no longer read.
  * `viewer.facts` is unchanged and still carries every stat.
* **`GET /api/v1/users/{id}/encounters` reads `entities`.** Before, the route ignored `entities` and always expanded everything.
  * The expansions are now opt-in: `tournament`, `stage`, `stage_item`, `teams`, `teams.players` (implies `teams`), and `matches`.
  * `matches.map` is the same as `matches`: a match always carries its `map` and its own `mode`.
  * Without them, a row is its header only: `id, name, slot_count, round, best_of, tournament_id, discipline, status, closeness, has_logs, result_status`.
  * In that case `tournament`, `stage` and `stage_item` are null, `teams` and `matches` are `[]`, and none of those tables are read.
  * `round` is always filled (the bracket row is always read).
  * `user_team_id` is resolved from the rosters, so it is null unless `teams.players` is requested.
* **`GET /api/v1/achievements/user/{id}`** (`UserAchievementRead`)
  * `tournaments_ids` and `matches_ids` are removed.
  * The audit found no reader in the frontend (site, admin, balancer), discord-service or any backend caller. They were only mentioned in a hand-written frontend type, now dropped, and in stats-service tests.
  * `condition_tree` stays. It sits on the shared `AchievementRead`, which `GET /achievements/{id}` serves and the achievement page reads (`AchievementConditionsCard`), as does the admin rule editor.
  * `tournaments` and `matches` are filled only when `entities` names them, as before. The overview's achievement preview now requests none.

## Measured sizes

Dev database, compact JSON bytes of the RPC reply, measured with Overwatch as the game:

* "Before" is the deployed code. It ignores `entities`, so every encounters page carries every expansion.
* "After" is this change, called with the `entities` each profile section now sends:
  * overview: `tournament, stage, stage_item, teams, teams.players, matches.map`;
  * header form streak: `teams, teams.players`;
  * matches tab: `USER_ENCOUNTER_ENTITIES`.

| Read | User | `workspace_id=1` (KB) | `workspace_id=all` (KB) |
|---|---|---|---|
| profile, with `discipline` | 40 | 256.2 → 29.0 | 256.2 → 29.0 |
| profile, with `discipline` | 43 | 256.1 → 33.0 | 350.0 → 53.7 |
| profile, with `discipline` | 599 | 197.4 → 27.0 | 327.9 → 65.9 |
| profile, all games | 40 | 251.5 → 8.1 | 251.5 → 8.1 |
| profile, all games | 43 | 251.5 → 8.1 | 345.4 → 9.7 |
| profile, all games | 599 | 192.9 → 6.2 | 323.4 → 8.2 |
| tournaments | 40 | 540.6 → 174.7 | 540.6 → 174.7 |
| tournaments | 43 | 508.0 → 166.3 | 654.7 → 251.1 |
| tournaments | 599 | 459.2 → 148.4 | 620.8 → 237.6 |
| encounters, overview (5) | 40 | 575.9 → 54.8 | 575.9 → 54.8 |
| encounters, overview (5) | 43 | 515.4 → 51.7 | 509.4 → 51.5 |
| encounters, overview (5) | 599 | 641.5 → 61.0 | 122.1 → 15.4 |
| encounters, header streak (10) | 40 | 1088.0 → 16.3 | 1088.0 → 16.3 |
| encounters, header streak (10) | 43 | 1022.9 → 16.7 | 518.3 → 16.7 |
| encounters, header streak (10) | 599 | 1088.2 → 16.6 | 637.0 → 12.7 |
| encounters, matches tab (15) | 40 | 1598.3 → 158.6 | 1598.3 → 158.6 |
| encounters, matches tab (15) | 43 | 1776.8 → 165.5 | 1035.5 → 111.7 |
| encounters, matches tab (15) | 599 | 1987.9 → 179.0 | 645.8 → 74.2 |
| tournament encounters (t73) | 40 | 703.8 → 66.7 | — |
| tournament encounters (t73) | 43 | 515.4 → 51.7 | — |
| tournament encounters (t73) | 599 | 641.4 → 61.0 | — |
| achievements, `entities=tournaments,matches` | 40 | 124.4 → 119.1 | 138.2 → 131.9 |
| achievements, `entities=tournaments,matches` | 43 | 129.5 → 124.0 | 148.4 → 141.8 |
| achievements, `entities=tournaments,matches` | 599 | 146.0 → 140.3 | 179.1 → 172.1 |
| achievements, no `entities` | 40 | 76.8 → 71.4 | 90.5 → 84.2 |
| achievements, no `entities` | 43 | 76.9 → 71.4 | 90.7 → 84.1 |
| achievements, no `entities` | 599 | 77.2 → 71.4 | 91.1 → 84.1 |

## Who must act

* **HTTP clients of these routes** (API-key integrations, scripts) must update:
  * read `/users/{id}/tournaments` as `results` and resolve grids through `division_grid_versions`;
  * pass `entities` to `/users/{id}/encounters` for anything beyond the row header;
  * stop reading `tournaments_ids`/`matches_ids`, and use `tournaments[].id`/`matches[].id` with `entities` instead;
  * stop reading `division_grid_version` on profile tournament cards and per-game roles.
* **In this repository** every caller is migrated: the profile page, admin people (`PersonGlance`, `PersonParticipationsTab`), and the balancer's player history (`workspace-helpers`). No backend service or discord-service calls these routes.

## Deploy

Deploy stats-svc, gateway and frontend together, from one SHA. Mixed versions break the tournament list: an old frontend maps the new object as an array, and a new frontend reads `results` off an old array. Old shapes can sit in three caches:

* **stats-service Redis cache.** The keys moved, so an old entry is never read by the new code:
  * `backend:user_profile:v2`;
  * `backend:user_tournaments:v2`;
  * `backend:user_tournament_encounters:v8`;
  * `backend:user_encounters:v8`, whose key now includes `entities`.
* **Gateway in-memory response cache.**
  * The profile, tournaments and encounters user routes are cached by URL for `GATEWAY_RESPONSE_CACHE_TTL`. The default is 30 s, and production does not override it.
  * The per-tournament reads are also invalidated by tournament events, under the same TTL.
  * The cache is in memory, so restarting the gateway container clears it. A gateway deploy restarts it, because `schemas.json` is embedded in the binary.
* **Frontend Next Data Cache.**
  * The server-side user reads revalidate every 300 s.
  * `docker-compose.production.yml` mounts no volume on `/app/.next` (only `./logs/frontend:/logs`). The build's `.next/cache` is a BuildKit cache mount, and the image copies only `.next/standalone` and `.next/static`.
  * So the runtime Data Cache lives in the container's writable layer. It does **not** survive a deploy that recreates the container from the new image. It **does** survive a plain restart of the same container (`restart: always`).
  * In dev (`docker-compose.yml`), `/app/.next` is a tmpfs, emptied on every restart.

If a service is restarted rather than recreated, or deployed apart from the others, expect old shapes for up to 300 s from the frontend and up to 30 s from the gateway.

## Verification

* **stats-service** (ephemeral test Postgres): the user, achievement, cross-game and reader-parity tests pass.
  * The frozen-golden reader parity test projects the new shapes back to the frozen ones. It checks that each character reference equals the entity it names, and that each earned-id array is rebuilt from the expanded links.
  * The full suite has 95 failures, all outside these reads:
    * the `tests/api/routes/*` cases that need the populated dev database (`User with id 599 not found`);
    * the draft-pick nodes on sqlite (`session.discipline`);
    * the test database lacks `division_grid_tier.canonical_number`;
    * the ingest-registry and DLQ-topology expectations predate Valorant and Deadlock.
* **New tests:**
  * a DB test that `entities` is opt-in, checking both the rows and that the stage, roster and fact tables go unread;
  * a check that every module's `member_total_stats` are its own stat codes.
* **Checks:** shared `test_disciplines.py`, `ruff check`/`ruff format`, and `export_openapi_schemas.sh --check`.
* **Dev measurement:** the table above, from the working tree staged in the dev stats container against the deployed code.
