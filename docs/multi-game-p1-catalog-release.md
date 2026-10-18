# Multi-game P1 catalog: release note and cutover runbook

P1 replaces the application reads and writes of `overwatch.hero`, `overwatch.map` and
`overwatch.gamemode` with `catalog.entity`. The cutover revision is `discipline01`, after
`mixround01`. Overwatch and League of Legends declare their catalog kinds and sync sources through
`shared.disciplines`; this does **not** enable LoL gameplay. The legacy tables and `catalog.entity_legacy`
stay until the separately gated `discipline02` cleanup. See the [architecture](./architecture.md) and
[catalog schema](./database_erd.md#catalog--catalog) for the shipped model.

This runbook is for the release operator. Take and verify a restorable backup before the window.
`discipline01` is forward-fix only: rollback after a committed cutover means restoring that backup and
the matching old application images, not running `alembic downgrade`.

## Breaking API changes

Deploy backend services, gateway schemas and frontend together. External clients must move with them.

1. **Every catalog id changes.** Hero, map and gamemode responses and embeddings now carry new catalog
   ids, including `/api/v1/catalog/{discipline}/{kind}/{id}`,
   `/heroes/{hero_id}/leaderboard`, `hero_id`, `left_hero_id`, `right_hero_id`, `map_id`, `gamemode_id`
   filters, pick-ban items, registration top heroes and achievement links. Do not reuse a stored legacy
   id as a new id. Until `discipline02`,
   `GET /api/v1/catalog/legacy/{hero|map|gamemode}/{id}` returns
   `{entity_id, discipline, kind, slug}` for an old id (404 if unknown). The site redirects its supported
   old hero/map query-filter links with 308; this is not an alias for every old API endpoint.
2. **Admin CRUD moves.** `/api/v1/admin/{heroes,maps,gamemodes}[/{id}]` is removed. Use
   `/api/v1/admin/catalog/{discipline}/{kind}[/{id}]` and `CatalogEntityCreate`, `CatalogEntityUpdate`,
   `CatalogEntityRead`. Core kinds are `character`, `map`, `mode`; module labels are presentation only.
3. **Sync moves and is admin-only.** `POST /api/v1/{heroes,maps,gamemodes}/update` is removed. Use
   `POST /api/v1/admin/catalog-sync/{discipline}` with a superuser identity.
4. **Alias worklist changes.** `entity_type` (`hero|map|gamemode`) becomes `discipline` plus `kind`
   (`character|map|mode`); `last_log_record_id` becomes `last_ingest_job_id`. Attach uses
   `{entity_id, alias}` with the new entity id.
5. **Map list sorting changes.** `/api/v1/catalog/{discipline}/map` uses sort key `parent_id`, not `gamemode_id`.
   The existing user-map statistics sort key `gamemode_id` is unchanged.
6. **Public catalog is native and per game.** `/api/v1/heroes`, `/maps`, `/gamemodes` and their
   `/lookup` operations are removed; `GET /api/v1/catalog/{discipline}/{kind}[/{id}]` serves every
   discipline's characters, maps and modes in one `CatalogEntityRead` shape (a map's mode is `parent`).

Admin deletion of a referenced entity now returns **409 `Catalog entity is in use`**, not 500.
Legacy mappings, encounter games and child entities can prevent deletion; use `active: false` to
retire an entry without removing history. Create/PATCH reject invalid character classes, non-string
`attrs.color` and non-boolean `attrs.in_competitive` with 422; PATCH validates the merged attrs.
Sync validates a source batch before mirroring images or writing entities and preserves existing
admin-edited attrs.

## Before the window

1. **Rehearse on an isolated restore.** Run the real `uv run alembic upgrade head` from the release
   database's current revision in one invocation, with the exact images and migration flags intended
   for the release. Do not substitute a sequence of separate per-revision upgrades. Live constraint,
   index and sequence names are resolved structurally; a missing or ambiguous expected object aborts
   instead of guessing. The revision drains pending deferred checks before any ALTER and restores
   initially deferred constraints for following revisions; an unexpected INITIALLY IMMEDIATE
   deferrable constraint stops it. `casual.match` and `tournament.encounter_map_code` are rewritten
   only if they still exist. Resolve migration heads before release; this guard does not merge heads.
2. **Measure the lock window on that restore.** `discipline01` rewrites the catalog-bearing columns in
   `matches.*` and validates the replacement FKs inline. Duration at production scale is not certified
   by fixture tests. P9 must use rehearsal measurements to decide whether validation needs a separate
   revision; no NOT VALID/separate-validation cutover is shipped by P1.
3. **Run the preflight, then repeat after writers are quiet.** From the repository root, against the
   intended database:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/discipline01_preflight.sql
   ```

   Both numbered result sets must be empty: colliding generated map slugs, and catalog slugs/names
   longer than their columns. Fix the listed source rows explicitly, never truncate them. The final
   dangling-pick-ban count is informational, not a stop condition: ids naming no legacy row are left
   untouched and remain below the new id space. Record its value. The migration repeats the same
   blocking queries; the standalone preflight buys time to reconcile data before the window.
4. **Quiesce producers and drain deliveries on the old images.** Disable incoming writes, log
   ingestion, catalog sync and scheduled producers. Leave existing consumers/outbox dispatchers running
   until all pending and failed outbox rows, including delayed retries, have been delivered:

   ```sql
   SELECT status, count(*) FROM event_outbox WHERE status <> 'published' GROUP BY status;
   ```

   This must return no rows. Inspect failed rows and their `last_error` rather than marking them
   published or deleting them. In RabbitMQ, wait for affected event, notification, cache-invalidation
   and job queues to have **zero ready and zero unacknowledged messages**. Resolve relevant dead-letter
   messages before the boundary; do not replay legacy-id payloads into the new release without an
   audited translation. Drain in-flight realtime deliveries too: stop publication, let gateway
   WebSocket/fan-out queues finish, then disconnect clients and stop the old gateway/workers. Redis
   realtime pub/sub has no durable queue to purge. Reconnect clients only after migration so they fetch
   migrated room snapshots/journals instead of retaining an old-id board. Do not erase persisted room
   journals as a substitute: `discipline01` rewrites their catalog item ids.

## Cutover, while traffic remains stopped

1. **Upgrade once**, using the release environment and its approved earlier destructive-migration
   flags, from `backend/`:

   ```sh
   uv run alembic upgrade head
   ```

   P1 itself drops no legacy catalog table, column or enum. A failed `discipline01` rolls its data
   transaction back; earlier revisions with committed autocommit blocks may remain applied. Inspect
   the current revision and the error before retrying. Never stamp past a failed data rewrite.
2. **Reconcile**, from the repository root:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/scripts/discipline01_reconcile.sql
   ```

   Every class in result set 1 must say `ok`; result set 2 must be empty. The report checks heroes,
   gamemodes, maps, alias misses and pick-ban soft references (including snapshots and room events).
   Replacement FKs prove the hard-reference rewrite because the old and new id spaces are disjoint.
   Also require no rows from:

   ```sql
   SELECT conrelid::regclass, conname FROM pg_constraint WHERE NOT convalidated;
   ```
3. **Flush cached old-id payloads before admitting new readers.** For each Redis logical database
   used for backend caches (normally `/4`, including parser/balancer caches), point
   `BACKEND_CACHE_URL` at that exact environment/database and remove the namespace, not the entire
   Redis server:

   ```sh
   redis-cli -u "$BACKEND_CACHE_URL" --scan --pattern 'backend:*' |
     while IFS= read -r key; do redis-cli -u "$BACKEND_CACHE_URL" UNLINK "$key"; done
   ```

   In particular, cached catalog-bearing reads include `backend:user_profile:*`,
   `backend:user_draft_card:*`, `backend:user_tournament_encounters:v3:*`,
   `backend:user_heroes:*`, `backend:user_maps:*`, `backend:user_encounters:v3:*`,
   `backend:user_compare:v2:*` and `backend:user_hero_compare:v2:*`; parser impact baselines use
   `backend:parser:impact_baselines:*`. Clear all `backend:*` rather than assuming this list is a
   complete dependency inventory. The app worker also clears this namespace on startup, but an old
   process must not repopulate it during cutover. Flush `fastapi:*` on its configured API-cache Redis
   database and restart gateway/frontend instances to discard their in-memory old-id responses and
   proxy caches. Do not use `FLUSHALL`: Redis holds non-cache state too.
4. **Populate `matches.mv_hero_global_stats` explicitly.** The migration recreates it WITH NO DATA.
   The first refresh must be plain, **not CONCURRENTLY**. With old workers stopped, run:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
   BEGIN;
   SET LOCAL statement_timeout = 0;
   SET LOCAL work_mem = '768MB';
   SET LOCAL enable_nestloop = off;
   SELECT pg_advisory_xact_lock(29384939747108694);
   REFRESH MATERIALIZED VIEW matches.mv_hero_global_stats;
   COMMIT;
   SELECT relispopulated FROM pg_class WHERE oid = 'matches.mv_hero_global_stats'::regclass;
   SQL
   ```

   The advisory-lock key is the refresher's `0x6865726F5F6756`; the final value must be `true`.
   Later application refreshes can use CONCURRENTLY. `hero_stats_refresh` debounces through Redis
   key **`backend:hero_global_stats:refresh_cooldown`** for **3600 seconds** *before* inspecting whether
   the view is populated. A surviving/recreated pre-deploy cooldown marker can suppress a requested
   startup refresh for up to an hour, leaving the recreated view unpopulated. The normal app-worker
   startup currently clears `backend:*` first, but do not rely on that background request or on its
   timing across replicas. The namespace flush above removes the marker; the explicit SQL refresh
   bypasses Redis and proves the view is ready before reads resume.
5. **Start only the matching new services and smoke the public paths.** Verify hero/map/mode lists,
   a legacy lookup/old-link redirect, user profile and hero stats, an encounter's map and pick-ban board,
   parser map/hero resolution and superuser catalog create/PATCH/delete (a referenced delete is 409).
   Confirm caches contain new ids and `relispopulated` is true. Resume producers and traffic only after
   reconciliation and these checks pass. Keep the backup and the captured preflight/reconcile output.

Run the reconcile again before `discipline02`; never drop the legacy catalog while it reports a
mismatch. Once new writes are accepted, restoring the backup loses those writes unless they are
separately captured and replayed: remain in maintenance if a cutover check fails.

## Development/staging databases already at an earlier `discipline01`

**Reset/recreate them and replay the complete current chain.** P1 amended this unreleased revision
several times. A database that already recorded `discipline01` will not run the amended copy on
`upgrade head`; it may still have legacy `matches.*` FKs/ids or pick-ban ids and silently return the
wrong data. Do not fix this with a stamp or by rerunning part of the SQL. Preserve any needed fixtures
outside the database, recreate it, upgrade and reseed. This instruction is for disposable dev/staging
instances, not permission to reset a release database.

For the repository's ephemeral host-test database only, from the repository root:

```sh
docker compose -f docker-compose.test.yml down
docker compose -f docker-compose.test.yml up -d --wait
```
