# Backend cleanup: schema split, removed endpoints, dead settings

Two database migrations ship, `schemasplit01` and `quota0003` (after `subrole01`). Deploy **every backend image and
the gateway from one SHA, right after the migration**. Old images query `balancer.registration*`, `balancer.custom_game*`
and `balancer.draft_*`, and those names stop existing once `schemasplit01` runs.

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
- **Retained P9 storage moves with its tables.** Examples are the legacy role columns and
  `balancer.discipline01c_dropped_ranks`, which stays in `balancer`. It is still dropped only by the gated
  `discipline02`.
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
