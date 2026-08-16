# Tournament Streams (stream-service) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` to implement this plan task-by-task.

**Design:** `docs/superpowers/specs/2026-08-16-tournament-streams-design.md`
**Issues:** #104 (live stream embeds), #99 (tournament links block — таблица вводится здесь)

## House Rules (apply to every task)

1. Prefix git/test/build commands with `rtk`. Even inside `&&` chains.
2. Edit files with the Edit/Write tools only. PowerShell mangles UTF-8 here.
3. Перед правкой файла — прочитать его целиком или нужный диапазон. Номера строк в плане взяты на 2026-08-16 и могли сдвинуться.
4. Не запускать линтеры/тесты/сборки внутри задач — только в Фазе 7. Исключение: задача явно просит.
5. Осознанные упрощения помечать `ponytail:`-комментарием с потолком и путём апгрейда (список — §5 спеки).
6. Новые файлы в `parser-service` **не** создавать: `schemas/admin/*` и `services/admin/*` там зеркала (`docs/superpowers/specs/2026-08-04-code-mirrors-registry.md`). `tournament_link` живёт только в `tournament-service`.
7. Схему Postgres `streams` **не** создавать. Состояние live — только Redis (Decision D2 спеки).

## Соглашения имён

| Сущность | Значение |
| --- | --- |
| Compose-сервис | `stream-svc` |
| Каталог | `backend/stream-service` |
| uv-пакет | `stream-service` |
| RPC-префикс | `rpc.stream.*` |
| HTTP-префикс | `/api/streams/` |
| Realtime-топик | `tournament:{id}:streams` |
| Settings-ключ | `stream.collection` |
| Metrics-порт | `9111` |
| Redis-ключи | `stream:live:{tournament_id}`, `stream:token`, `stream:poll:last_run` |

---

## Phase 0 — Pre-flight

### Task 1: Починить мёртвые ссылки на несуществующие сервисы

**Files:**
- Modify: `backend/pyrightconfig.json:9,13` — убрать `"auth-service"` и `"twitch-service"` из `include`; добавить реально существующие `tournament-service`, `analytics-service`, `identity-service`, и новый `stream-service`.
- Modify: `backend/analytics-worker.gpu.Dockerfile:45,47,51` — удалить три `COPY` для `auth-service`, `realtime-service`, `twitch-service` (каталогов нет — файл сейчас не собирается); добавить `COPY stream-service/pyproject.toml /app/stream-service/pyproject.toml`.

Список реально существующих сервисов: `app-service`, `identity-service`, `parser-service`, `tournament-service`, `discord-service`, `balancer-service`, `analytics-service` (+ новый `stream-service`). Сверить с `backend/Dockerfile:27-33`.

**Definition of Done:** ни `grep -r "twitch-service"`, ни `auth-service`, ни `realtime-service` не находятся нигде, кроме исторических docs/логов. Список `COPY` в `analytics-worker.gpu.Dockerfile` совпадает с таким же блоком в `backend/Dockerfile`.

---

## Phase 1 — Данные: `tournament_link`

### Task 2: Модель `TournamentLink`

**Files:**
- Create: `backend/shared/models/tournament/link.py`
- Modify: `backend/shared/models/tournament/__init__.py` — добавить `from .link import *`
- Create: `backend/shared/tests/test_tournament_link_model.py`

Образец для модели — `PlayerSubRole` в `backend/shared/models/tournament/team.py:125-151` (типизированные строки + `sort_order` + soft-delete `is_active`). Целевое содержимое — блок из §4.1 спеки. Обязательно:

- `__tablename__ = "tournament_link"`, `{"schema": "tournament"}`;
- `tournament_id` FK `tournament.tournament.id` `ondelete="CASCADE"`, `index=True`, NOT NULL;
- `kind: Mapped[str] = mapped_column(String(32), nullable=False)` — **не** PG enum (расширение набора типов не должно требовать миграции; тот же выбор, что `Tournament.team_formation`, `tournament.py:51` — там есть комментарий-обоснование, повторить его смысл);
- `label: String(128) | None`, `url: String(500)` NOT NULL;
- `sort_order: Integer` NOT NULL `server_default="0"`;
- `is_active: Boolean` NOT NULL `server_default="true"`;
- `UniqueConstraint("tournament_id", "kind", "url", name="uq_tournament_link_tournament_kind_url")`;
- `Index("ix_tournament_link_tournament_active", "tournament_id", "is_active")`;
- `__all__ = ("TournamentLink", "TOURNAMENT_LINK_KINDS")`, где `TOURNAMENT_LINK_KINDS: frozenset[str] = frozenset({"discord", "stream", "vod", "bracket", "rules", "other"})` — единственный источник истины набора типов, из него же валидируется Pydantic-схема.

Тест — по образцу `backend/shared/tests/test_roster_slots_models.py` / `test_subscription_table_ddl.py`: проверить имя схемы/таблицы, наличие уникального ограничения и индекса, `server_default` у `sort_order`/`is_active`, `ondelete="CASCADE"` у FK.

### Task 3: Миграция

**Files:**
- Create: `backend/migrations/versions/<rev>_tournament_link.py`

`down_revision` — текущий head (узнать: `rtk grep "down_revision" backend/migrations/versions` + найти ревизию, на которую никто не ссылается). Образец дочерней таблицы турнира с FK CASCADE и UniqueConstraint — `initial_v6.py:1658-1699` (`tournament_phase_schedule`).

`upgrade()`: один `op.create_table("tournament_link", ..., schema="tournament")` + `op.create_index("ix_tournament_link_tournament_active", ...)`. `CREATE SCHEMA` **не** нужен — `tournament` уже существует. `downgrade()`: `op.drop_index` + `op.drop_table`.

**Definition of Done:** `rtk grep "CREATE SCHEMA" backend/migrations/versions` по-прежнему находит только `initial_v6.py`.

### Task 4: Схемы и сервис `tournament_link`

**Files:**
- Create: `backend/tournament-service/src/schemas/admin/tournament_link.py`
- Create: `backend/tournament-service/src/services/admin/tournament_link.py`
- Modify: `backend/tournament-service/src/core/auth.py` — добавить `get_tournament_link_workspace_id`

Схемы — ровно три модели по образцу `backend/tournament-service/src/schemas/admin/player_sub_role.py:1-38`:

- `TournamentLinkRead(BaseRead)` — `tournament_id, kind, label, url, sort_order, is_active`;
- `TournamentLinkCreate` — `tournament_id, kind, url` обязательны, `label=None`, `sort_order=0`, `is_active=True`; валидатор `kind in TOURNAMENT_LINK_KINDS` → иначе `ValueError`; валидатор `url` — только схемы `http`/`https`;
- `TournamentLinkUpdate` — все поля `Optional=None` под `exclude_unset`.

Сервис — по образцу `backend/tournament-service/src/services/admin/player_sub_role.py:31-145`:

- `list_links(session, tournament_id)` — `order_by(sort_order.asc(), id.asc())`, только `is_active` при флаге, по умолчанию все;
- `create_link` — **явная** проверка конфликта `(tournament_id, kind, url)` → `HTTPException(409)`, не ловля `IntegrityError`; сервис владеет своим `commit` + `refresh`;
- `update_link` — `model_dump(exclude_unset=True)`, повторная проверка конфликта при смене ключа;
- `deactivate_link` — **soft**: `is_active = False`.

Резолвер воркспейса — транзитивный через `Tournament.workspace_id`, образец `get_tournament_workspace_id` в `backend/tournament-service/src/core/auth.py:36-39`.

### Task 5: Регистрация в generic-движке админ-CRUD

**Files:**
- Modify: `backend/tournament-service/src/services/admin/registry.py` — импорты + запись `"tournament_link"` в `REGISTRY` перед закрывающей скобкой (:315)

Образец — блок `"player_sub_role"` (:299-315). Отличия:

- `permission_resource="tournament_link"`;
- `resolve_ws_from_id=auth.get_tournament_link_workspace_id`;
- `resolve_ws_for_create=_ws_via_tournament_body` (у сущности нет своей `workspace_id`, только `tournament_id` — резолверы `_ws_via_tournament_*` уже есть в этом файле, :60-90);
- `resolve_ws_for_list` — резолвер через `tournament_id` из query (не `_ws_query`: воркспейс выводится из турнира);
- `actions=frozenset({"create", "update", "delete", "list"})`.

Новых RPC-очередей заводить **не нужно** — сущность едет через существующие `rpc.tournament.admin.{create,get,update,delete,list}` (:322-340). Аудит `tournament_link.{create,update,delete}` приезжает бесплатно через `CrudDispatcher._audit` (`backend/shared/rpc/crud.py:216-232`).

### Task 6: Публичное чтение ссылок

**Files:**
- Modify: сериализатор публичного overview турнира в `tournament-service` (найти обработчик `rpc.tournament.get_tournament` и его `entities`-переключатель; вход — `backend/tournament-service/src/openapi_docs.py:9-13` и `src/rpc/`)

Добавить `entities`-токен `"links"`: при его наличии в ответ едет `links: TournamentLinkRead[]`, отфильтрованные `is_active`, отсортированные `sort_order`. Конвенция расширения ответа через `entities`, а не новый эндпоинт — `frontend/src/services/tournament.service.ts:93-105`.

### Task 7: Роуты gateway для `tournament_link`

**Files:**
- Modify: `gateway/internal/tournament/admin_routes.go` — 4 строки по образцу :39-43

```go
{Method: "GET",    Pattern: "/api/v1/admin/tournament-links",      Queue: "rpc.tournament.admin.list",   Entity: "tournament_link", Query: []string{"tournament_id", "workspace_id"}, Auth: edge.AuthRequired},
{Method: "POST",   Pattern: "/api/v1/admin/tournament-links",      Queue: "rpc.tournament.admin.create", Entity: "tournament_link", Body: true, Auth: edge.AuthRequired, Success: 201},
{Method: "PATCH",  Pattern: "/api/v1/admin/tournament-links/{id}", Queue: "rpc.tournament.admin.update", Entity: "tournament_link", IDParam: "id", Body: true, Auth: edge.AuthRequired},
{Method: "DELETE", Pattern: "/api/v1/admin/tournament-links/{id}", Queue: "rpc.tournament.admin.delete", Entity: "tournament_link", IDParam: "id", Auth: edge.AuthRequired, Success: 204},
```

Точные имена полей `RouteSpec` сверить с `gateway/internal/edge/routespec.go:16-40`. Форму паттерна (дефис или подчёркивание) — с соседями в том же файле.

- Modify: `backend/tournament-service/src/openapi_docs.py` — `summary`/`description` для ключей `rpc.tournament.admin.{create,update,delete,list}#tournament_link`
- Modify: `backend/tournament-service/src/openapi_schemas.py` — записи `Op(...)` для тех же ключей (формат — `backend/shared/rpc/openapi.py:24-60`, образец таблицы — `backend/balancer-service/src/openapi_schemas.py:17-33`)

**Definition of Done:** `rtk bash backend/scripts/export_openapi_schemas.sh` обновляет `gateway/internal/openapi/schemas.json`, и `--check` проходит.

---

## Phase 2 — RBAC и настройки

### Task 8: Права

**Files:**
- Modify: `backend/shared/rbac/catalog.py:65` — вставить после `*_crud("asset")`:
  ```python
  *_crud("tournament_link"),
  _permission("stream", "read", "Read stream live-status and polling health"),
  _permission("stream", "update", "Trigger a stream live-status re-poll"),
  ```
- Modify: `backend/shared/rbac/catalog.py:102` — добавить `"tournament_link"` в `_MEMBER_READ_RESOURCES` после `"asset"`. `"stream"` туда **не** добавлять (health поллера рядовому участнику не нужен — аналогия с `rank`/`subscription`/`audit`, :66-70).
- Create: `backend/shared/tests/test_rbac_catalog_stream_permission.py`

Тест — три теста по образцу `backend/shared/tests/test_rbac_catalog_audit_permission.py:1-19`: (1) пары `("tournament_link", action)` и `("stream", "read"/"update")` есть в `PERMISSION_CATALOG`; (2) `admin` получает их, `owner == ("admin.*",)`; (3) `member` получает `tournament_link.read` но **не** `stream.*`, `player` — ничего.

Миграция не нужна: `ensure_permission_catalog` (`backend/shared/rbac/bootstrap.py:13-36`) идемпотентно апсертит по `name`.

### Task 9: Настройка `stream.collection`

**Files:**
- Modify: `backend/shared/schemas/settings.py` — три точки: константа ключа (после :33), модель (после `SubscriptionCollectionConfig`, :80), запись в `SETTINGS_SCHEMAS` (:137-142) + экспорт в `__all__` (:16-28, кортеж отсортирован)
- Modify: `backend/shared/services/settings_provider.py` — аксессор по образцу `get_subscription_collection_config:92-99`

```python
SETTINGS_KEY_STREAM_COLLECTION = "stream.collection"


class StreamCollectionConfig(BaseModel):
    """Operational config for the periodic Twitch live-status poller.

    ``enabled=False`` by default so a missing/empty key can never start hitting
    Twitch Helix on the shared app-token bucket (800 points/min, shared with
    identity-service). ``batch_size`` is capped at 100 — the hard limit of
    ``user_login``/``user_id`` values Helix ``GET /streams`` accepts per request.
    """

    enabled: bool = False
    interval_seconds: int = Field(default=60, ge=30, le=3600)
    batch_size: int = Field(default=100, ge=1, le=100)
```

Записывать настройку уже умеет `backend/parser-service/src/services/admin/settings.py:49-62` — новый ключ подхватится сам через `SETTINGS_SCHEMAS`. Нового роута не нужно.

---

## Phase 3 — Каркас `stream-service`

### Task 10: Пакет и точка входа

**Files:**
- Create: `backend/stream-service/pyproject.toml` — по образцу `backend/tournament-service/pyproject.toml` (requires-python >=3.13, `faststream[rabbit,cli]`, `httpx[socks]`, `apscheduler`, `shared`, `[tool.mypy] strict`)
- Create: `backend/stream-service/.python-version` — копия из `backend/tournament-service/.python-version`
- Create: `backend/stream-service/README.md` — по образцу `backend/analytics-service/README.md` (что за процесс, как запускать, зависимости, конфиг)
- Create: `backend/stream-service/src/__init__.py`, `src/core/__init__.py`, `src/core/config.py`, `src/core/db.py`, `src/core/broker.py`
- Create: `backend/stream-service/serve.py`
- Create: `backend/stream-service/tests/__init__.py`
- Modify: `backend/pyproject.toml:13` — `stream-service` в `[tool.uv.workspace] members` и в `[tool.ty.environment]` (три списка, все отсортированы)

`serve.py` — дословный каркас `backend/analytics-service/serve_rpc.py` (весь файл, 73 строки) с заменами: `service_name="stream-svc"`, регистрация `src.rpc.reads` и `src.rpc.admin`, плюс в `@app.on_startup` после метрик — `poll_scheduler.start_scheduler()`, и `@app.on_shutdown` с `poll_scheduler.shutdown_scheduler()` (образец старт/стопа — `backend/parser-service/serve.py:184-196`). Брокер — только через `make_rabbit_broker` (`backend/shared/observability/broker.py:16`), он сам ставит `DeadlineDropMiddleware`.

`src/core/config.py` — наследник `BaseServiceSettings` (`backend/shared/core/config.py`) с полями `twitch_client_id: str | None`, `twitch_client_secret: str | None`, `twitch_helix_url: str = "https://api.twitch.tv/helix"`, `twitch_token_url: str = "https://id.twitch.tv/oauth2/token"`. `proxy_url` и `worker_metrics_port` уже в базовом классе.

`src/core/broker.py` — `set_worker_broker`/`optional_broker` по образцу `backend/parser-service/src/core/broker.py:20-42` (нужен публикаторам вне подписчика — тику шедулера).

### Task 11: Инфраструктурная обвязка

**Files:**
- Modify: `backend/Dockerfile:27-33` — `COPY stream-service/pyproject.toml /app/stream-service/pyproject.toml`
- Modify: `docker-compose.yml` — блок `stream-svc` по образцу `analytics-svc` (:318-355): `build.args APP_PATH=stream`, `command: faststream run serve:app --reload --reload-dir …`, `env_file` = `backend/env/common.env` + `backend/env/stream.env`, `WORKER_METRICS_PORT=9111`, bind-mount `./backend/stream-service` и `./backend/shared`, `deploy.resources`, `depends_on` redis/rabbitmq
- Modify: `docker-compose.production.yml` — блок `stream-svc` по образцу `analytics-svc` (:425-471): без `--reload`, `restart: always`, `WORKER_METRICS_PORT=9111`, `extra_hosts`, healthcheck `python -c "exit(0)"`
- Create: `backend/env/stream.env.example` — по образцу `backend/env/tournament.env.example`: `TWITCH_CLIENT_ID=`/`TWITCH_CLIENT_SECRET=` с комментарием «тот же Twitch app, что у identity-service» (прецедент — `tournament.env.example:26`)
- Modify: `monitoring/prometheus/prometheus.yml:52-117` — scrape job `stream-svc` на `stream-svc:9111`, с тем же `relabel` для `instance`, что у соседей
- Modify: `.github/workflows/test-backend.yml:46` — `stream-service` в `for svc in …` (иначе `backend/stream-service/tests/` не запускаются)
- Modify: `backend/scripts/export_openapi_schemas.sh:39` — `stream-service` в массив `services`
- Modify: `Makefile` — цели, перечисляющие сервисы (найти по `rtk grep "analytics-svc" Makefile`)

Порт 9111 свободен: заняты 9100/9103/9106/9107/9108/9109, gateway — 9110.

---

## Phase 4 — Поллер

### Task 12: Helix-клиент под app access token

**Files:**
- Create: `backend/stream-service/src/services/helix.py`
- Create: `backend/stream-service/tests/test_helix_client.py`

Таксономию ошибок скопировать по форме из `backend/shared/subscriptions/providers/twitch_helix.py:50-76` (`HelixNotConfigured`, `HelixUnauthorized`, `HelixRateLimited`, `HelixUnavailable`). Сам тот клиент **не** переиспользуется — он под user token и `GET /subscriptions/user`.

Контракт:

- `async def get_app_token(redis, *, client_id, client_secret, token_url, proxy) -> str` — `POST` с `grant_type=client_credentials`, кэш в Redis под `stream:token` с TTL `expires_in - 60`. `client_id`/`client_secret` пусты → `HelixNotConfigured`.
- `async def get_live_streams(*, logins: Sequence[str], user_ids: Sequence[str], token, client_id, helix_url, proxy) -> list[StreamSnapshot]` — батчи ≤100, параметры **повторяются**: `?user_login=a&user_login=b` (не через запятую — `https://dev.twitch.tv/docs/api/guide/`, «Specifying multiple query parameter values»). Заголовки `Authorization: Bearer …` + `Client-Id`. 401 → удалить `stream:token` и один retry. 429 → `HelixRateLimited(reset_at)` из заголовка `Ratelimit-Reset`. Возвращать также `ratelimit_remaining` из `Ratelimit-Remaining` — вызывающий использует его как гейт.
- `GET /streams` возвращает **только живые** каналы; отсутствие канала в ответе = offline. Это зафиксировать комментарием, иначе следующий читатель будет искать поле `is_live`.
- Egress — `proxy=settings.proxy_url` (образец использования — как OverFast в `parser-service`).

`StreamSnapshot` — dataclass/Pydantic: `platform="twitch"`, `channel` (login), `url`, `title`, `game_name`, `viewer_count`, `thumbnail_url`, `started_at`. `thumbnail_url` из Helix содержит плейсхолдеры `{width}x{height}` — подставить конкретный размер (`440x248`) в клиенте, а не на фронте.

Тесты — без сети: Helix инжектируется как callable, ровно как это сделано в `shared/subscriptions/providers/twitch_helix.py` («Helix access is injected as a callable, so the whole decision table is testable without a network»). Покрыть: батчинг >100 логинов на два запроса, повторяющиеся параметры, 401→refresh→retry, 429→`HelixRateLimited`, пустой `client_id`→`HelixNotConfigured`.

### Task 13: Выборка целей опроса

**Files:**
- Create: `backend/stream-service/src/services/targets.py`
- Create: `backend/stream-service/tests/test_target_queries.py`

Три функции, читающие **только** чужие схемы (запись запрещена — правило границ, `backend/docs/tournament-service-write-path-inventory.md`):

1. `active_tournament_ids(session) -> list[tuple[int, int, bool]]` → `(tournament_id, workspace_id, is_hidden)` для `Tournament.status IN (CHECK_IN, DRAFT, LIVE, PLAYOFFS)`. Использовать `enums.TournamentStatus`, не строки. **Не** опираться на `Tournament.is_finished` — он не синхронизируется автоматически со `status`.
2. `official_stream_links(session, tournament_id) -> list[str]` → `url` из `tournament.tournament_link` где `kind='stream' AND is_active`.
3. `participant_channels(session, tournament_id) -> list[ParticipantChannel]` — объединение двух источников:
   - самозаявленный: `balancer.registration.twitch_nick` где `deleted_at IS NULL AND status='approved' AND stream_pov IS TRUE AND twitch_nick IS NOT NULL`, `player_id` через `workspace_member.player_id`;
   - verified: `players.social_account` где `provider='twitch' AND is_verified IS TRUE`, **обязательный** JOIN на `players.social_account_visibility` с `workspace_id IS NULL`.

Точные SQL — §4.3 спеки; образец того же пути JOIN — `backend/parser-service/src/services/subscription_collection/service.py:114-135`.

`ParticipantChannel`: `{player_id, login, provider_user_id | None, source: "self_declared" | "verified"}`. Для `verified` предпочитать `provider_user_id` (стабилен при переименовании канала), для `self_declared` — `login`.

**Приватность — жёсткое требование.** Фильтр видимости живёт в SQL-выборке, не в сериализаторе. Тест обязателен: verified-аккаунт **без** глобальной строки `social_account_visibility` в результат не попадает. Без этого фича обходит `visible_only` (`backend/app-service/src/services/user/flows.py:116-143`).

### Task 14: Тик, шедулер, публикация

**Files:**
- Create: `backend/stream-service/src/services/state.py` — Redis-состояние
- Create: `backend/stream-service/src/services/poller.py` — один тик
- Create: `backend/stream-service/src/services/scheduler.py` — APScheduler + leader-lock
- Create: `backend/stream-service/tests/test_poll_tick.py`
- Modify: `backend/shared/services/realtime_topics.py` — функция `streams(tournament_id)` + имя в `__all__`

`realtime_topics.streams`:

```python
def streams(tournament_id: int) -> str:
    """Public-subscribable spectator topic: which channels are live for a tournament.

    Non-durable — the poller publishes a thin ``stream.updated`` signal with no
    ``realtime.workspace_event`` row, for the same reason as ``logs.updated``:
    a reconnecting client refetches anyway.
    """
    return f"tournament:{int(tournament_id)}:streams"
```

`state.py`: `read_live(redis, tournament_id) -> dict[str, dict]`, `write_live(redis, tournament_id, snapshots, ttl)` (`HSET` + `EXPIRE`, полная перезапись через `DELETE`+`HSET` в пайплайне), `get_last_run(redis)`/`set_last_run(redis)`. TTL = `3 × interval_seconds`. Ключи — из таблицы «Соглашения имён».

`poller.py::run_poll_tick(session, redis, cfg) -> int`:
1. `active_tournament_ids`;
2. для каждого — собрать множество каналов (официальные + участники), дедуп по `(platform, channel)`;
3. один батчевый вызов Helix на все каналы всех турниров (дедуп глобальный — один канал может стримить в двух турнирах), затем разложить результат обратно по турнирам;
4. гейт по `ratelimit_remaining < 100` → остановить остаток тика, залогировать, вернуть обработанное;
5. диф с `read_live`; при изменении множества live-каналов — `write_live` **и** один `publish_envelope_to_redis` с `event_id=0`, `event_type="stream.updated"`, `data={"tournament_id": tid, "live_count": n}` (образец — `backend/shared/services/subscription_realtime.py:66-79`);
6. **скрытый турнир** (`is_hidden`) — `write_live` делаем, публикацию в топик **не** делаем;
7. `set_last_run` в конце успешного тика.

`scheduler.py` — форма 1:1 `backend/parser-service/src/services/subscription_collection/scheduler.py:39-141`:
- `SCHEDULER_TICK_SECONDS = 30`, `LEADER_LOCK_KEY = "stream_poll:scheduler:leader"`, `LEADER_LOCK_TTL_SECONDS = SCHEDULER_TICK_SECONDS * 2`;
- `acquire_distributed_lock(..., acquire_timeout_seconds=0.0)` → `DistributedLockUnavailable` = тихий skip;
- `async with observe_scheduled_job("stream_poll")`;
- гейт `cfg = await settings_provider.get_stream_collection_config(session); if not cfg.enabled: return 0`;
- «пора ли» решается **внутри** тика: `last_run + interval_seconds`, источник — `stream:poll:last_run` в Redis. Причина ровно та, что в докстринге образца (:6-12): интервал admin-editable, шедулер, прибитый к стартовому значению, сделал бы отображаемое число ложью;
- `release_distributed_lock` в `finally`;
- `AsyncIOScheduler(timezone="UTC")`, `max_instances=1`, `coalesce=True`.

Метрики (`shared/observability/metrics.py` — посмотреть, как объявляются существующие): `stream_poll_ticks_total`, `stream_channels_polled`, `stream_live_channels`, `stream_helix_errors_total{kind}`, `stream_helix_ratelimit_remaining`.

Тесты `test_poll_tick.py` (Helix и Redis — фейки, без сети и без БД где возможно): диф не изменился → публикации нет; канал включился → ровно одна публикация на турнир; скрытый турнир → `write_live` есть, публикации нет; `enabled=False` → ноль вызовов Helix; `ratelimit_remaining` ниже порога → тик останавливается.

---

## Phase 5 — Чтение: RPC + gateway

### Task 15: RPC-хендлеры `rpc.stream.*`

**Files:**
- Create: `backend/stream-service/src/rpc/__init__.py`, `src/rpc/_common.py`, `src/rpc/reads.py`, `src/rpc/admin.py`
- Create: `backend/stream-service/src/schemas/__init__.py`, `src/schemas/stream.py`
- Create: `backend/stream-service/src/openapi_docs.py`, `src/openapi_schemas.py`
- Create: `backend/stream-service/tests/test_rpc_tournament_streams.py`

`_common.py` — копия `backend/analytics-service/src/rpc/_common.py` (хелперы `q/q1/qbool/payload/actor/require_permission/require_id/require_query_int/dump` + `envelope()`), выкинув неиспользуемое. Конверт ответа — `shared/schemas/rpc.py` (`rpc_ok`/`rpc_error`).

`reads.py`:
- `@broker.subscriber("rpc.stream.tournament_streams")` — публичный. **Первым делом** `assert_tournament_viewable` (`backend/shared/services/tournament_visibility.py`) — правило модуля: кэшируемые публичные сериализаторы читают без зрителя, поэтому проверка стоит до чтения; скрытый турнир отдаёт 404, не 403. Затем `read_live` из Redis + обогащение именами игроков (`players.user.name`, `avatar_url`) и официальными ссылками.
- Ответ: `TournamentStreamsRead { official: StreamEntryRead[], participants: StreamEntryRead[] }`, где `StreamEntryRead { platform, channel, url, live, title, game_name, viewer_count, thumbnail_url, started_at, player }`, `player: {id, name, avatar_url} | None`. Оффлайновые официальные ссылки отдаются с `live=false` (ссылка нужна всегда), участники — **только** живые (список «кто сейчас в эфире»).
- Отдавать YouTube и прочие официальные ссылки из `tournament_link` c `platform`, выведенным из хоста URL, и `live=None` — live-детекта у них нет (A4 спеки). `live: bool | None` — `None` означает «неизвестно», а не «оффлайн»; на фронте это отсутствие бейджа, а не серый бейдж.

`admin.py`:
- `@broker.subscriber("rpc.stream.repoll")` — `ensure_workspace_permission(user, ws_id, "stream", "update")`, затем `record_audit(action="stream.repoll", source="admin", workspace_id=ws_id, entity_type="tournament", entity_id=tid, ip_address=data.get("ip_address"), user_agent=data.get("user_agent"))` **до** `session.commit()` (порядок — часть контракта, `backend/shared/services/audit.py:8-16`), затем сброс `stream:poll:last_run` чтобы следующий heartbeat отработал сразу. Success 202.
- Тест: успех даёт ровно одну строку аудита, откат — ни одной (образец `backend/shared/tests/test_audit_scope.py:227-263`).

`openapi_schemas.py` — таблица `OPERATIONS: dict[str, Op]` по образцу `backend/balancer-service/src/openapi_schemas.py:17-33`; `openapi_docs.py` — `DOCS: dict[str, dict]` по образцу `backend/tournament-service/src/openapi_docs.py:9-13`.

### Task 16: Домен gateway `/api/streams/*`

**Files:**
- Create: `gateway/internal/stream/routes.go`
- Create: `gateway/internal/stream/cacheable.go`
- Create: `gateway/internal/stream/routes_test.go`
- Modify: `gateway/cmd/gateway/main.go` — импорт + регистрация + guard
- Modify: `gateway/internal/apidocs/groups.go` — группы public и admin
- Modify: `gateway/internal/acl/acl.go:82-87` — одна строка топика
- Modify: `gateway/internal/edge/apiv1_guard_test.go` — `buildStreamsGuardedMux` + тест регистрации
- Modify: `frontend/next.config.mjs` — rewrite `/api/streams/*` → gateway

`routes.go` — по образцу `gateway/internal/analytics/routes.go:20-57`, две таблицы:

```go
var PublicRoutes = []edge.RouteSpec{
    {Method: "GET", Pattern: "/api/streams/tournament/{tournament_id}", Queue: "rpc.stream.tournament_streams",
     Path: []string{"tournament_id"}, AllQuery: true, Auth: edge.AuthNone},
}

var AdminRoutes = []edge.RouteSpec{
    {Method: "POST", Pattern: "/api/streams/tournament/{tournament_id}/repoll", Queue: "rpc.stream.repoll",
     Path: []string{"tournament_id"}, Query: []string{"workspace_id"}, Auth: edge.AuthRequired, Success: 202},
}
```

`cacheable.go`:

```go
// ponytail: TTLOnly, not tournament-scoped invalidation. respcache only parses
// tournament:{id}:bracket|draft topics and keys its invalidation index by
// tournament_id, so an invalidated stream route would cost a new reason case in
// respcache.go plus a matching one in realtime_commit.py — three files in two
// languages to shave seconds off a cold load, on a surface where the WS signal
// already gives open pages immediacy. Upgrade path: Extract:
// respcache.FromPathValue("tournament_id") + case "stream_changed".
var PublicCacheableReads = map[string]respcache.Rule{
    "/api/streams/tournament/{tournament_id}": {Extract: respcache.TTLOnly()},
}
```

`main.go`: импорт домена рядом с :24-52; регистрация рядом с :293-295 —
`streamEdge := edge.New(rpcClient, logger, resolver.Resolve)`, затем `respcache.RegisterCached(mux, streamEdge, stream.PublicRoutes, stream.PublicCacheableReads, respCache)` и `streamEdge.Register(mux, stream.AdminRoutes)`; guard-блок `/api/streams/` — дословная копия :360-368 с заменой префикса. **Без guard новый префикс уедет в катч-олл `/` и получится петля gateway↔frontend.**

`acl.go` — одна строка после :86:

```go
r.register("tournament:*:streams", r.allowSpectateTournament) // public unless hidden
```

Резолвер выбран не случайно: `allowSpectateTournament` — это ровно «public unless hidden» (комментарии :82-83), то есть гейтинг скрытых турниров на подписке приезжает бесплатно.

`routes_test.go` — два drift-гарда по образцу `gateway/internal/tournament/cacheable_test.go:11-50` (каждый паттерн из map кэша существует в таблице как GET) и `routes_test.go:52-62` (регистрация всех таблиц на свежий `ServeMux` без panic).

`apiv1_guard_test.go` — третий `buildStreamsGuardedMux` по образцу :40-95 + тест «роуты зарегистрированы» по образцу :130-160. Мотивировка в комментарии :126-129 объясняет, зачем: новый путь достижим только если он в таблице, которую регистрирует `main.go`, иначе guard отвечает 404 и фича мертва без ошибки компиляции.

---

## Phase 6 — Фронтенд

### Task 17: Типы, сервис, запросы, хуки

**Files:**
- Create: `frontend/src/types/stream.types.ts`
- Create: `frontend/src/services/stream.service.ts`
- Create: `frontend/src/app/(site)/tournaments/[id]/_queries/tournamentStreams.ts`
- Create: `frontend/src/app/(site)/tournaments/[id]/_hooks/useTournamentStreams.ts`
- Create: `frontend/src/hooks/useTournamentStreamRealtime.ts`
- Modify: `frontend/src/lib/tournament-query-keys.ts` — `streams: (tournamentId) => ["tournament", tournamentId, "streams"] as const` и `links: (tournamentId) => ["tournament", tournamentId, "links"] as const`

Генерации типов из OpenAPI в проекте нет — типы пишутся руками в `src/types/*.types.ts` и синхронизируются с бэкендом глазами. Типы: `StreamPlatform`, `StreamEntry` (`live: boolean | null`), `TournamentStreams`, `TournamentLink`, `TournamentLinkKind`.

Сервис — статический класс по образцу `frontend/src/services/tournament.service.ts:93-105`; публичный read обязательно `skipWorkspace: true`.

Фабрика `queryOptions()` — образец `_queries/tournamentOverview.ts` (весь файл, 12 строк). `staleTime` для стримов — `30_000`.

Хук — образец `_hooks/useTournamentClientData.ts` (24 строки), обязателен гвард `enabled: Number.isFinite(tournamentId) && tournamentId > 0`.

`useTournamentStreamRealtime` — подписка на `tournament:{id}:streams` через `useRealtimeTopic`. **Обязателен** trailing-coalescer с per-client джиттером `250 + Math.floor(Math.random() * 2500)` мс по образцу `frontend/src/hooks/useTournamentRealtime.ts:30-45,87-126`: одно событие турнира веерно летит всем зрителям, без джиттера это синхронный рефетч-герд. Плюс catch-up на 4-м аргументе `onSubscribed` (leading-coalescer 100 мс). Патч-редьюсер (`registerRealtimeResource`) **не** нужен — сигнал тонкий, рефетч дешевле, чем реестр под один счётчик.

### Task 18: Компоненты плеера и карточки

**Files:**
- Create: `frontend/src/components/stream/TwitchEmbed.tsx`
- Create: `frontend/src/components/stream/StreamCard.tsx`
- Create: `frontend/src/lib/stream-platform.ts`
- Create: `frontend/src/components/stream/TwitchEmbed.test.tsx`

`TwitchEmbed`: `<iframe src="https://player.twitch.tv/?channel={channel}&parent={host}&muted=true" allowFullScreen>`, минимум 400×300 (жёсткое требование Twitch), `title` для a11y.

**`parent` — критичная деталь.** Twitch требует, чтобы `parent` совпадал с фактическим доменом страницы, по одному ключу на домен. Платформа white-label: апекс + сабдомены + произвольные кастомные домены. Значит:
- значение — `window.location.hostname`, нормализованное как в `resolveHost` (`frontend/src/lib/host.ts:17`: `trim().toLowerCase().split(":")[0]`; Twitch не принимает порт);
- читать **после маунта** (`useEffect`/`useSyncExternalStore`), до этого плеер не рендерить — SSR хостнейма не знает. Прецеденты чтения хоста на клиенте: `components/WorkspaceBootstrap.tsx:43`, `services/realtime.service.ts:41-42`;
- брать из `NEXT_PUBLIC_SITE_URL` (`config/site.ts:5`, дефолт — платформенный апекс) **нельзя**: на кастомном домене тенанта не совпадёт и плеер откажет. Написать это комментарием в файле, иначе кто-то «упростит».

`stream-platform.ts` — определение платформы по хосту URL (`twitch.tv` → twitch, `youtube.com`/`youtu.be` → youtube, иначе `other`) + `STREAM_STATUS_META` реестром по образцу `frontend/src/lib/tournament-status.ts` (комментарий там прямо фиксирует правило: доменный факт живёт в реестре один раз, а не вложенным ternary по месту вызова).

`StreamCard` — карточка канала: превью (`<img>`, не `next/image` — в `next.config.mjs` стоит `unoptimized: true`, так что новый `remotePatterns` для `static-cdn.jtvnw.net` не нужен), заголовок, `viewer_count`, live-пилюля и идентити стримера. Переиспользовать:
- live-индикатор `.status-pill.live` + `.dot` (`frontend/src/app/globals.css:2071-2109`) — скоуп-класс `aqt-tn` уже висит на корне публичной страницы турнира (`TournamentClientLayout.tsx:92`), так что работает без изменений. Визуальный образец — `frontend/src/app/(site)/tournaments/components/FeaturedLive.tsx:56-59`;
- бейдж стримера — `frontend/src/components/social/SocialAccountBadge.tsx`, каталог провайдеров с Twitch (#9146FF, иконка, `profileUrl`) — `frontend/src/lib/social-providers.ts`;
- `ui/badge.tsx` **не** использовать: на публичных страницах турнира конвенция — семантические классы `.status-pill.{variant}`, а `ui/badge.tsx` живёт в админке/аналитике.

A11y-урок из `FeaturedLive.tsx:40-45`: карточка не должна навигировать по `onClick` на `<article>` — ссылку несёт заголовок, stretched-overlay ломает кнопки в футере.

Тест `TwitchEmbed.test.tsx`: `parent` берётся из `window.location.hostname` и нормализуется (порт отбрасывается, регистр вниз); до маунта iframe не рендерится.

### Task 19: Блок официальной трансляции и таб стримов

**Files:**
- Create: `frontend/src/app/(site)/tournaments/[id]/_views/TournamentStreamPage.tsx`
- Create: `frontend/src/app/(site)/tournaments/[id]/stream/page.tsx`
- Create: `frontend/src/app/(site)/tournaments/[id]/_components/TournamentBroadcastBlock.tsx`
- Modify: `frontend/src/app/(site)/tournaments/[id]/_components/TournamentClientLayout.tsx:166-168` — вставка блока между `PageHero` и `TournamentSectionNav`
- Modify: `frontend/src/app/(site)/tournaments/[id]/_components/tournament-section-nav.ts:3-4,55-64` — `stream` в union `TournamentSectionId` и в массив `tournamentSections`
- Modify: `frontend/src/app/(site)/tournaments/[id]/_components/TournamentSectionNav.tsx:35-45` — иконка для `stream`
- Modify: словари i18n — ключ `common.stream` (`labelKey` жёстко шаблонизирован как `common.${id}`)

`stream/page.tsx` — 11 строк, дословный образец `frontend/src/app/(site)/tournaments/[id]/maps/page.tsx` (`"use client"`, `useParams`, `key={tournamentId}`). Вся логика — во вью.

`TournamentStreamPage.tsx` **обязан** гонять состояния через `_views/publicPageQueryPresentation.ts` (`skeleton`/`error`/`empty`/`content`/`updating`/`refresh-error`), а не свои ternary — это покрыто контракт-тестом `public-page-states.contract.test.ts`.

`TournamentBroadcastBlock` — persistent-блок официальной трансляции: плеер (только когда `live === true`), иначе ссылка-фолбэк. `PageHero` рядом уже содержит live-пилюлю статуса турнира (:128-133) — не дублировать её визуально, стрим-бейдж должен читаться как отдельный факт.

Таб `stream` показывать только если у турнира есть хоть одна ссылка `kind='stream'` **или** непустой список участников-стримеров — иначе пустой таб на каждом турнире. Механику гейтинга взять из `competitionOnlySections`/`hasSchedule`/`hasTeams` в том же `tournament-section-nav.ts:40-53`.

---

## Phase 7 — Верификация

### Task 20: Бэкенд

**Step 1.** `rtk bash backend/scripts/export_openapi_schemas.sh` → затем `rtk bash backend/scripts/export_openapi_schemas.sh --check` должен пройти (иначе CI падает с «schemas.json is STALE»).
**Step 2.** `rtk bash backend/scripts/lint.sh` (ruff) и `rtk bash backend/scripts/format.sh`.
**Step 3.** `rtk make test` — вся бэкенд-сюита. Обязательно зелёные: `backend/tests/test_repository_boundaries.py`, `backend/shared/tests/test_rbac_catalog_stream_permission.py`, `backend/shared/tests/test_tournament_link_model.py`, `backend/stream-service/tests/`.
**Step 4.** Миграция в обе стороны: `rtk docker compose exec app-svc alembic upgrade head` затем `alembic downgrade -1` затем снова `upgrade head`.
**Step 5.** `rtk go build ./...` и `rtk go test ./...` в `gateway/`. Обязательно зелёные: `internal/edge/apiv1_guard_test.go`, `internal/apidocs/groups_test.go`, `internal/stream/routes_test.go`.

### Task 21: Фронтенд

**Step 1.** `rtk tsc --noEmit` (или `rtk npm run typecheck`) в `frontend/`.
**Step 2.** `rtk lint` в `frontend/`.
**Step 3.** `rtk vitest run` в `frontend/` — обязательно зелёный `public-page-states.contract.test.ts`.

### Task 22: Смоук — фича реально работает

Смоук важнее тестов: проверяем, что фича живёт, а не что файлы компилируются.

1. `rtk docker compose up -d --wait` (+ `stream-svc`).
2. `rtk docker compose logs stream-svc` — воркер поднялся, шедулер стартовал, тик логирует «disabled in settings» (дефолт `enabled=False`).
3. Включить настройку через админ-эндпоинт настроек (`stream.collection` → `{"enabled": true, "interval_seconds": 30, "batch_size": 100}`), прописать `TWITCH_CLIENT_ID`/`SECRET` в `backend/env/stream.env`.
4. Создать `tournament_link` с `kind='stream'` на существующий турнир в статусе `live` через админ-API; в качестве канала взять любой заведомо живой Twitch-канал.
5. `curl` на `/api/streams/tournament/{id}` — ответ содержит `official` с `live=true`.
6. Открыть публичную страницу турнира в браузере: блок трансляции с плеером виден, плеер **играет** (это и есть проверка `parent=`), live-пилюля горит. Проверить на платформенном хосте **и** на tenant-хосте, если он настроен локально.
7. Погасить канал (или подменить на заведомо оффлайновый) → в пределах интервала бейдж гаснет без перезагрузки страницы (WS-сигнал).

### Task 23: Документация

**Files:**
- Modify: `docs/architecture.md` — `stream-svc` в mermaid-диаграмму (:35-44) и в таблицу компонентов (:132-143); упомянуть новый топик в §3 «Realtime» (:120-125)
- Modify: `backend/README.md:17-26` — строка сервиса в таблицу
- Modify: `docs/superpowers/specs/2026-08-16-tournament-streams-design.md` — `**Status:** accepted (2026-08-16)`, снять пометку «открыто на решение» у D2
- Modify: `.superpowers`/issue-трекинг: закрыть #104, отметить в #99 что таблица `tournament_link` введена

## Definition of Done

1. `rtk make test` зелёный.
2. `rtk go test ./...` в `gateway/` зелёный.
3. `rtk tsc --noEmit` и `rtk vitest run` во `frontend/` зелёные.
4. `rtk bash backend/scripts/export_openapi_schemas.sh --check` проходит.
5. Миграция применяется и откатывается.
6. Смоук из Task 22 пройден: плеер играет на публичной странице, live-бейдж гаснет по WS без перезагрузки.
7. `rtk grep -r "twitch-service"` не находит ничего вне docs/логов.
8. Схема Postgres `streams` **не** создана; `rtk grep "CREATE SCHEMA" backend/migrations/versions` находит только `initial_v6.py`.

## Rollout Notes

- `stream.collection.enabled = False` по умолчанию — фича приезжает выключенной. Включать после того, как в `backend/env/stream.env` прописаны Twitch-креды.
- Twitch app-бакет (800 points/min) общий с identity-service. Если начнутся 429 в логах identity — снизить `interval_seconds` наверх, не вниз.
- CSP в проекте сейчас нет. Когда её введут, она **обязана** содержать `frame-src https://player.twitch.tv https://www.youtube-nocookie.com`, `img-src … https://static-cdn.jtvnw.net` и `Permissions-Policy: autoplay=(self "https://player.twitch.tv"), fullscreen=(self "https://player.twitch.tv")` — иначе плеер отвалится в момент харденинга. Занести в тикет по CSP.
