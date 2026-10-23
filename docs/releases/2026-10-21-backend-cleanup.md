# Backend cleanup: schema split, removed endpoints, dead settings

Two database migrations ship, `schemasplit01` and `quota0003` (after `subrole01`). Deploy **every backend image and
the gateway from one SHA, right after the migration**. Old images query `balancer.registration*`, `balancer.custom_game*`
and `balancer.draft_*`, and those names stop existing once `schemasplit01` runs. After the Riot/LoL release's `rank01`,
`legacy01` drops the legacy storage the cutovers kept; it has its own runbook (section 5).

## 1. Schema split (`schemasplit01`)

`balancer` held 34 tables for four domains. It keeps the balancer's own 9. The other 25 move into new schemas, with the
redundant prefix dropped from each table name:

| New schema | Tables (old `balancer.` name → new) |
| --- | --- |
| `registration` | `registration`, `registration_form` → `form`, `registration_form_version` → `form_version`, `registration_form_template` → `form_template`, `registration_google_sheet_feed` → `google_sheet_feed`, `registration_google_sheet_binding` → `google_sheet_binding`, `registration_identity` → `identity`, `registration_role` → `role`, `registration_role_entity` → `role_entity`, `registration_status` → `status`, `registration_team` → `team`, `registration_team_invite` → `team_invite` |
| `mix` | `custom_game`, `custom_game_co_host` → `co_host`, `custom_game_lobby` → `lobby`, `custom_game_player` → `player`, `custom_game_player_role` → `player_role`, `custom_game_round` → `round`, `custom_game_round_member` → `round_member`, `custom_game_team_name` → `team_name` |
| `draft` | `draft_session` → `session`, `draft_team` → `team`, `draft_player` → `player`, `draft_pick` → `pick`, `draft_audit_event` → `audit_event` |
| `balancer` (stays) | `balance`, `balance_variant`, `team`, `team_slot`, `tournament_config`, `user_config`, `workspace_config`, `member_rank`, `member_hidden_rating` |

- **What the migration does.** It renames only and rewrites no rows: `SET SCHEMA`, then `RENAME`, plus renames of the
  owned id sequences, indexes and unique constraints to the names the models produce. These are catalog-only operations,
  so the migration is quick at any data size. `alembic downgrade subrole01` restores every original name exactly.
- **Legacy storage moves with its tables.** Examples are the legacy role columns and
  `balancer.discipline01c_dropped_ranks`, which stays in `balancer` until `legacy01` (section 5) drops it.
- **Code renames.** The ORM classes `BalancerRegistration*` are now `Registration*`; the pydantic API schemas keep their
  `BalancerRegistration*` component names. Model packages are now `shared.models.mix` and `shared.models.draft`, and
  `shared.balancer_registration_statuses` is now `shared.registration_statuses`.
- **Unchanged wire names.** `rpc.balancer.*` and the realtime event `balancer.registrations_changed` keep their names.
- **New stored values.** Achievement dependency strings (`depends_on`) are now `registration.registration` and
  `draft.pick`. The user-merge record key is now `registration.registration.workspace_member_id`. Rows stored with the
  old values are inert.
- **Ad-hoc SQL and dashboards.** Anything that names the old tables (SQL consoles, BI, saved queries) must switch to the
  new names. The repository's one-off `backend/scripts/*.sql` belong to migrations that have already shipped, and keep
  the old names on purpose.

## 2. Removed endpoints and inputs

| Removed | Notes |
| --- | --- |
| `POST /api/v1/analytics/openskill` (`rpc.analytics.openskill`) | It only ever answered 410 |
| `POST /api/v1/analytics/train`, `POST /api/v1/analytics/infer` | Also removed: the `analytics_train` / `analytics_infer` queues and their DLQs, their worker consumers, and their `quota.operation` rows (`quota0003`; its downgrade restores the `quota0002` seed) |
| `PATCH /api/v1/auth/player/linked/{player_id}/primary` (`rpc.identity.player.set_primary`) | It changed nothing |
| `is_primary` on player link requests | Ignored before; unknown fields are still accepted |
| `auth_user_id` on admin unlink, `dry_run` on Challonge source discovery | Signature-only parameters |
| `GET /api/v1/catalog/legacy/{legacy_kind}/{legacy_id}` (`rpc.app.catalog.legacy`) | It resolved old hero/map/gamemode ids through `catalog.entity_legacy`, which `legacy01` drops. The site's 308 redirect of old `hero_id` / `map_id` filters on `/users/heroes-compare`, `/users/compare` and `/tournaments/{slug}/matches` goes with it: links that still carry an old id are no longer rewritten |

Durable queues are not deleted automatically. After the deploy, delete them in RabbitMQ management:
`analytics_train`, `analytics_infer` and their `.dlq` queues.

## 3. Settings no longer read

Services no longer read the following keys. Every settings class ignores unknown env, so leaving them in a deployed
`.env` is harmless, and they can be removed:

- `PORT`, `DEBUG`, `PROJECT_NAME`, `PROJECT_URL`, `CORS_ORIGINS`
- `AUTH_SERVICE_URL` / `_TIMEOUT` / `_MAX_RETRIES`, `CIRCUIT_BREAKER_*`
- balancer `CORS_ALLOW_*`, `LOG_FORMAT`, `ACCESS_TOKEN_SERVICE`
- app `API_V1_STR` and the cache TTLs for tournaments, gamemodes, maps, heroes, statistics, teams and encounters
- discord `LOGS_CELERY_ROOT_PATH`

`auth.env.example` now names the real identity keys `ACCESS_TOKEN_EXPIRE_MINUTES` and `REFRESH_TOKEN_EXPIRE_DAYS`. The
old `JWT_*` spellings were never read.

## 4. Code layout

- **No legacy re-export shims.** Services import models from `shared.models` and import
  `errors` / `pagination` / `utils` / `enums` from `shared.core`. The per-service `src/models` packages are gone, along
  with identity's `src/models.py`, `src/core/enums.py`, and the `src/core` re-exports.
- **Dead code removed.** A vulture pass, checked against every caller including tests, scripts, `serve*.py`, the gateway
  and string dispatch, deleted about 1,900 lines of unreferenced repository methods, helpers and their test-only tests.
- **Package markers.** Empty `__init__.py` files stay: they are package markers that pytest, import-linter and the
  boundary tests rely on.

## 5. Legacy storage drop (`legacy01`)

`legacy01` (after `rank01`) drops everything the cutovers kept, unmapped and unread, only for their pre-flight and
reconcile tooling:

- the `matches`, `log_processing`, `overwatch` and `casual` schemas, `matches.mv_hero_global_stats` included;
- `catalog.entity_legacy`, `roster.team_format_legacy`, `encounter.team_member_role_legacy`,
  `balancer.discipline01c_dropped_ranks`, `tournament.player_sub_role` and the V1 encounter tables
  `tournament.encounter_captain_report`, `_game_result`, `_map_code`, `_map_report`, `_participant`, `_readiness`;
- the unmapped legacy columns: the home/away, score and FFA leftovers on `encounter.*` and `tournament.stage`, the text
  `role` columns of ranks, slots, registrations, mixes, drafts and ML artifacts, the slot-map JSON columns, the old
  workspace grid pointer, and `registration.registration`'s `battle_tag`, `battle_tag_normalized` and `smurf_tags_json`
  (with `uq_registration_tournament_tag_active`);
- the enum types only that storage used (`heroclass`, `logstatsname`, `matchevent`, `abilityevent`,
  `catalogentitytype`, `log_processing_*`, the old `tournament` pick-ban/link/map-veto types).

It replaces the planned `discipline02` and `mixround02`, the P9 drop of the statistics source, and the
`OWT_APPLY_ENCOUNTER_LAYER_DROP` (`enclayer02`) and `OWT_APPLY_SPLIT_LOWER_BRACKET_DROP` (`bsplit02`) flags: where those
ran with their flags there is simply less left to drop. The downgrade raises; going back means restoring the backup.

**The gate.** When every legacy table is empty (a fresh or CI database), `legacy01` drops without a flag. When one still
holds a row it needs `OWT_APPLY_LEGACY_DROP=1`. Without the flag it raises before dropping anything, naming the tables
that hold rows, and the revision is not stamped: alembic runs the whole `upgrade` in one transaction, so the database
stays at the revision it started from and a rerun with the flag picks up from there. Unlike the older gated drops, a run
without the flag is never a silent no-op stamp.

**Production runbook.**

1. Take and verify a restorable backup.
2. From `backend/`, `alembic upgrade rank01`: every cutover up to it runs (catalog, roles, ranks, statistics, the
   encounter layer, mix rounds, the Riot/LoL rank schema), and legacy01 is not reached yet.
3. With writers drained, run the cutover proofs against that database; each must come back clean, exactly as its runbook
   says. Keep the outputs with the backup: after the drop they cannot be rerun.
   - `backend/scripts/discipline01_preflight.sql` and `discipline01_reconcile.sql`: the
     [P1](../multi-game-p1-catalog-release.md), [P2](../multi-game-p2-roles-release.md) and
     [P3](../multi-game-p3-ranks-release.md) runbooks.
   - `enclayer01_preflight.sql` and `enclayer01_reconcile.sql`: the
     [encounter layer V1 runbook](../encounter-layer-v1-release.md). Where `enclayer02` was stamped without its flag,
     this reconcile is the only proof that every V1 row was carried.
   - `mixround01_preflight.sql` and `mixround01_reconcile.sql`: the mix-round cutover.
   - `uv run python scripts/stats01_reconcile.py --mode check …` against the initial receipt, and
     `stats01_prepare.py` for the raw-source review: the
     [P4 statistics cutover](../../backend/README.md#p4-statistics-cutover-stats01--stats01a) notes, plus
     [P5 sections 13 and 14](./2026-10-15-multi-game-p5-ingest.md#13-p9-maintenance-release-old-queues-drain-rollback).
4. `OWT_APPLY_LEGACY_DROP=1 alembic upgrade head`, with the flag in the migration environment
   (`backend/env/app.env` on the host: `app-svc` runs `alembic`). Remove it afterwards.

A plain `alembic upgrade head` on a database that still holds a legacy row stops at `legacy01` with
`legacy01 refuses the drop: N legacy table(s) still hold rows (…)`. Nothing is dropped and nothing is stamped; run
step 3, then step 4.
