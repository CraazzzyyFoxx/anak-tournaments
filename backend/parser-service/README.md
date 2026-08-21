# Parser Service

Ingests and parses Overwatch match logs into OWT's shared domain models, fetches player ranks, and
runs scheduled/event-driven processing.

- **Type:** headless FastStream (RabbitMQ) RPC worker + event consumers + APScheduler — no HTTP
  server of its own
- **Entry point:** `serve.py`
- **Run:** `faststream run serve:app`
- **CLI:** `backfill_impact.py` (MVP-impact backfill)
- **Reached via:** the Go gateway (the sole HTTP entry point) under `/api/v1`

See [`../../docs/architecture.md`](../../docs/architecture.md) for the system overview.

## Responsibilities

The RPC surface is grouped as representative `rpc.parser.*` methods served behind the gateway:

- **Match-log ingestion** — parse and normalize match-log data into the [`shared/`](../shared/README.md)
  models. Logs carry map/gamemode/hero names in the reporting client's locale, so names resolve
  through the `aliases` column on `overwatch.{hero,map,gamemode}` — never through code. Anything
  that resolves to neither the canonical name nor an alias lands in `overwatch.catalog_alias_miss`,
  the "add an alias" queue behind `/admin/aliases`, keyed on `(entity_type, raw_name)` with an
  occurrence counter. A miss is recorded in its own transaction, so the 404 that fails an unknown
  map cannot roll it away; hero misses are batched per log because they are soft (an unknown hero
  drops the kill/stat row and the log still completes). See `src/services/catalog_aliases.py`.
- **OverFast catalog sync** — `rpc.parser.metadata.sync_{heroes,maps,gamemodes}` (superuser).
  The hero sync pulls all 13 Blizzard locales (`GET /heroes?locale=…`, one request per locale) and
  folds the localised names into `hero.aliases`; it only ever adds, never removes. OverFast exposes
  no `locale` parameter for `/maps` or `/gamemodes`, so map and gamemode aliases are admin-supplied
  (localisations, seasonal variants, apostrophe spellings).
- **Event consumers** — upload + process match-log (durable job channel), achievement evaluate,
  tournament encounter-completed, rank fetch (+ priority), and registration-approved rank check.
- **OverFast rank fetch** — a Redis leader-locked APScheduler that fetches player ranks from the
  external OverFast API (via the outbound proxy).
- **Match-log stall recovery** — a Redis leader-locked APScheduler that republishes
  `LogProcessingRecord`s the queue dropped (`process_match_log` expires messages after 5 minutes, and
  a worker killed mid-parse leaves a record on `processing`). See
  `src/services/match_logs/reaper.py`.
- **Typed reads / admin** — parser-unique reads and admin operations (logs, rank, achievements,
  misc, impact).

> **Note:** `ortools` is declared as a dependency but is not currently used (never imported); there
> is no OR-Tools optimization in this service.

## Dependencies

- **Postgres** — shared ORM (matches / overwatch_rank / log_processing schemas).
- **Redis** — scheduler leader lock and caching.
- **RabbitMQ** — RPC transport, event consumers, and durable job queues.
- **S3** — match-log storage.
- **External OverFast API** — rank data plus the hero/map/gamemode catalog (heroes in all 13
  Blizzard locales), reached via the outbound proxy.

> **Adding a map, hero or locale needs no deploy.** Run the OverFast sync for heroes, or add the
> alias in `/admin/{heroes,maps,gamemodes}` — or straight from the miss queue in `/admin/aliases`,
> which attaches the alias and closes the miss in one request.

## Configuration & environment

See `backend/env/parser.env`, which inherits `backend/env/common.env`. An outbound proxy can be
configured (`PROXY_HOST` / `PROXY_PORT`) for fetching external data (e.g. OverFast).
