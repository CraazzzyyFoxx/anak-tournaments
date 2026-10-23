# Stats owns the statistics reads

The public statistics, `/users/*` player-statistics and achievement reads moved from app-service to stats-service in one
cutover, together with their read caches, the `cache.invalidated` consumer and the global character-stats
materialized-view refresh. **HTTP is unchanged**: every path, query parameter, response body and error code stays the
same; only the RPC subject behind each route, and the process that answers it, changed. No migration ships. Deploy the
**gateway, `app-svc`, `stats-svc` and `stats-worker` from one SHA, together** (section 3).

The organizer dashboard (`rpc.app.statistics.{admin_dashboard,admin_dashboard_trends,tournament_readiness}`), which this note leaves on app-service, moved to tournament-service the same day: [tournament owns the organizer dashboard](./2026-10-23-tournament-owns-organizer-dashboard.md).

## 1. Subjects

| HTTP (`GET /api/v1/…`) | Old subject | New subject |
| --- | --- | --- |
| `statistics/{discipline}/characters/playtime` | `rpc.app.statistics.character_playtime` | `rpc.stats.statistics.character_playtime` |
| `statistics/{discipline}/characters/{entity_id}/leaderboard` | `rpc.app.statistics.character_leaderboard` | `rpc.stats.statistics.character_leaderboard` |
| `statistics/{discipline}/maps` | `rpc.app.statistics.maps` | `rpc.stats.statistics.maps` |
| `statistics/champion` | `rpc.app.statistics.champion` | `rpc.stats.statistics.champion` |
| `statistics/winrate` | `rpc.app.statistics.winrate` | `rpc.stats.statistics.winrate` |
| `statistics/players` | `rpc.app.statistics.players` | `rpc.stats.statistics.players` |
| `statistics/records` | `rpc.app.statistics.records` | `rpc.stats.statistics.records` |
| `users/overview` | `rpc.app.users.overview` | `rpc.stats.users.overview` |
| `users/overview/stats` | `rpc.app.users.overview_stats` | `rpc.stats.users.overview_stats` |
| `users/overview/catalog` | `rpc.app.users.overview_catalog` | `rpc.stats.users.overview_catalog` |
| `users/{id}/compare` | `rpc.app.users.compare` | `rpc.stats.users.compare` |
| `users/{id}/compare/characters` | `rpc.app.users.compare_characters` | `rpc.stats.users.compare_characters` |
| `users/{id}/profile` | `rpc.app.users.get_profile` | `rpc.stats.users.get_profile` |
| `users/{id}/draft-card` | `rpc.app.users.draft_card` | `rpc.stats.users.draft_card` |
| `users/{id}/tournaments` | `rpc.app.users.tournaments` | `rpc.stats.users.tournaments` |
| `users/{id}/tournaments/{tournament_id}` | `rpc.app.users.tournament` | `rpc.stats.users.tournament` |
| `users/{id}/tournaments/{tournament_id}/encounters` | `rpc.app.users.tournament_encounters` | `rpc.stats.users.tournament_encounters` |
| `users/{id}/tournaments/{tournament_id}/leaderboard` | `rpc.app.users.tournament_leaderboard` | `rpc.stats.users.tournament_leaderboard` |
| `users/{id}/maps` | `rpc.app.users.maps` | `rpc.stats.users.maps` |
| `users/{id}/maps/summary` | `rpc.app.users.maps_summary` | `rpc.stats.users.maps_summary` |
| `users/{id}/encounters` | `rpc.app.users.encounters` | `rpc.stats.users.encounters` |
| `users/{id}/matches/summary` | `rpc.app.users.matches_summary` | `rpc.stats.users.matches_summary` |
| `users/{id}/characters` | `rpc.app.users.characters` | `rpc.stats.users.characters` |
| `users/{id}/teammates` | `rpc.app.users.teammates` | `rpc.stats.users.teammates` |
| `achievements` | `rpc.app.read.list` + `entity: achievement` | `rpc.stats.achievements.list` |
| `achievements/{id}` | `rpc.app.read.get` + `entity: achievement` | `rpc.stats.achievements.get` |
| `achievements/{id}/users` | `rpc.app.achievements.users` | `rpc.stats.achievements.users` |
| `achievements/user/{user_id}` | `rpc.app.achievements.user` | `rpc.stats.achievements.user` |

* **Stay on app-service:** `rpc.app.users.{list,search,by_name}` (`/users`, `/users/search`, `/users/{name}`) and
  `rpc.app.statistics.{tournament_readiness,admin_dashboard,admin_dashboard_trends}`.
* **Removed:** the generic `rpc.app.read.{get,list}` pair (`src/rpc/reads_generic.py`, `src/services/read_registry.py`)
  and its OpenAPI keys `rpc.app.read.{get,list}#achievement`; achievement was its only entity. Workspace
  `rpc.app.admin.{update,delete}` keeps the shared CRUD engine.
* **Who must act:** HTTP clients, nobody. Anything that publishes the old subjects straight onto RabbitMQ (a script, a
  hand-rolled client) must switch to the new ones: after the deploy the old subjects have no consumer and time out.

## 2. Processes, caches and the invalidation consumer

* **RPC process.** `stats-svc` (`serve_rpc.py`) registers the three read modules (`src/rpc/{statistics,users,achievement_reads}.py`)
  on a channel of their own (`RPC_PREFETCH_COUNT`), so a burst of cold compare reads never shares a QoS window with the
  admin and ingest handlers. At startup it FLUSHDBs Redis db 4 (`backend:`), the read-cache database; app-svc's startup
  flushes the same database, as before.
* **Read caches.** The `@versioned` caches moved with their readers. `shared.services.user_cache` (was
  `app-service/src/services/user_cache.py`) is the contract between both sides: app-service profile/identity edits bump
  the user generations, stats-service keys its `/users/*`, map and achievement-rarity caches by them and by the
  tournament-data generations every tournament write bumps.
* **Settings.** `USERS_CACHE_TTL` (300 s), `USER_PROFILE_CACHE_TTL` (60 s) and `ACHIEVEMENTS_CACHE_TTL` (300 s) are
  stats-service settings now, read from `backend/env/stats.env`; app-service no longer reads them. Defaults are
  unchanged. A deployment that overrode one in `app.env` must move the override to `stats.env` (the leftover key in
  `app.env` is ignored).
* **Consumer.** `cache_invalidation_app_service` (`CACHE_INVALIDATION_APP_QUEUE` / `_DLQ`) is replaced by
  `cache_invalidation_stats_service` (`CACHE_INVALIDATION_STATS_QUEUE` / `_DLQ`), consumed by `stats-worker` with the
  same binding (`cache.invalidation`, `cache.invalidated.#`), TTL (5 min) and dead-lettering. app-svc consumes no
  invalidation queue any more.
* **Materialized view.** The debounced `stats.mv_entity_global_stats` refresh (`src/services/hero_stats_refresh.py`)
  moved to `stats-worker`: requested at its startup and on every `tournament.standings` invalidation, with the same
  Redis cooldown key, advisory lock and session settings.
* **Gateway.** `gateway/internal/stats/routes.go` (`PublicReadRoutes`, `AchievementsSubtreeRoutes`) and
  `cacheable.go` (`PublicCacheableReads`, the anonymous response-cache allowlist) hold the moved routes; app keeps
  `/users`, `/users/search` and `/users/{name}`. `gateway/internal/openapi/schemas.json` and
  `frontend/src/types/api.generated.ts` are regenerated; the wire shapes are unchanged.

## 3. Deploy

1. **One SHA, all four processes.** A new gateway publishes `rpc.stats.*` subjects an old `stats-svc` does not answer;
   an old gateway publishes `rpc.app.*` subjects a new `app-svc` no longer answers. Either mix fails those routes on
   the RPC deadline until all four run the new image. `make prod-up` (the release workflow) recreates them in one
   pass; expect a short window of failed public reads while the containers roll.
2. **Cold caches.** The first `stats-svc` start flushes db 4, so the public reads start cold: expect a burst of heavy
   aggregation queries on `stats-svc` right after the deploy.
3. **Lost retries before the first worker start.** Until the new `stats-worker` has started once, its queue does not
   exist and invalidations reach only the old queue. The writer's commit already bumps the generations, so only the
   durable re-bump of those events is lost.
4. **Delete the orphaned queues.** After the deploy nothing consumes `cache_invalidation_app_service`, but it stays
   bound to `cache.invalidation` and keeps receiving every invalidation; its 5-minute TTL then dead-letters each one
   into `cache_invalidation_app_service.dlq`. That trips `RabbitMQConsumersMissing`, `RabbitMQDLQMessagesGrowing` and
   eventually `RabbitMQDLQMessagesHigh` (`monitoring/prometheus/rules/rabbitmq.yml`). Durable queues are not deleted
   automatically; once the new `stats-worker` is consuming, delete both on the broker (or in RabbitMQ management):

   ```sh
   rabbitmqctl delete_queue cache_invalidation_app_service
   rabbitmqctl delete_queue cache_invalidation_app_service.dlq
   ```
5. **Sizing.** `stats-svc` now carries the read-path sizing `app-svc` had (`docker-compose.production.yml`: 2 CPUs /
   1 GiB limit, 0.75 CPU / 512 MiB reserved) and the same replica counts (`Makefile` `PROD_SCALE_*`: 1 at small, 2 at
   medium and large). `app-svc` keeps its numbers for now, although its heaviest reads left; watch both services' CPU,
   memory and RPC latency (`GatewayRPCShedding` by queue) after the deploy and shrink `app-svc` once the numbers show it.

## 4. Code layout

* **Moved packages.** `app-service/src/services/{statistics,hero,map,user}` → `stats-service/src/services/` (same
  names); `app-service/src/services/achievements` → `stats-service/src/services/achievement_reads`;
  `services/{discipline_queries,encounter_seats,hero_stats_refresh}.py` → stats `src/services/`;
  `app-service/src/services/user_cache.py` → `backend/shared/services/user_cache.py`.
* **Identity stays.** app-service keeps a slim `src/services/user/` (`UserService.to_read`, `get_by_slug`, `get_all`,
  `search_by_name`; `UserIdentityQueries`). The stats `UserService` and `UserProfileQueries` keep only the statistics
  reads.
* **RPC helpers.** `require_discipline`, `optional_discipline`, `gate_tournament` and `analytics_context` live in stats
  `src/rpc/_common.py`; app's `_common.py` keeps `optional_discipline` and `gate_tournament`.
* **Schemas.** Stats owns the user, statistics, catalog, achievement-read, user-base and division-grid read schemas.
  App's `schemas/statistics.py` keeps only `TournamentReadiness`, `UserSearch` stays app-only, and app code imports
  `CatalogEntityRead` from `shared.schemas.catalog`.
* **Import layering.** app-service's `services-layers` contract is now `dashboard` → `user | workspace`; stats-service
  adds `read-services-layers` (`achievement_reads` → `user` → `hero | map | statistics`) with the three grandfathered
  `map.service` imports ([layering](../../backend/docs/architecture/layering.md)).
* **Leftovers removed.** The empty stats-service directories `src/services/{hero,map,encounter,gamemode,baselines}` and
  `src/domain/match_logs`, and the stray local `graft/` caches under `src/services/ingest/` and `tests/`, were deleted
  before the move. None was tracked by git.
