# Realtime shared library: патч-доставка вместо thin-signal+refetch — design

Design produced through single-agent `brainstorming` with the организатором, начиная с конкретной проблемы (200 rps на 10 pregame-комнатах / 100 человек) и расширенный по явному запросу до системного решения для bracket/streams/logs/subscriptions. Прошёл полный `multi-agent-brainstorming` (Skeptic / Constraint Guardian / User Advocate + arbitration) — см. §6-§9. **Status: APPROVED, готов к написанию implementation-плана.**

## 1. Understanding summary

**Что.** Общая (shared) инфраструктура realtime-доставки данных: два переиспользуемых примитива — **patch** (снапшот/дельта в payload, клиент патчит React Query кэш напрямую) и **thin-signal** (debounce+coalesce перед рефетчем по HTTP), вместо копипасты одного и того же кода под каждый топик. **Важно (после трёх раундов ревью, см. §6-§8):** эта волна мигрирует все четыре топика (bracket/streams/logs/subscriptions) НА thin-signal примитив — ни один не получает patch-режим в этом заходе (изначально планировалось для streams, отклонено в Phase 2.2, см. D8). Patch-примитив тем не менее строится как часть библиотеки — он уже проверен балансер-драфтом и отдельно одобренным pregame-треком, и остаётся доступен для следующего кандидата.

**Почему.** Отправная точка — pregame pick-ban room: `invalidateRoom()` (PregameRoom.tsx) синхронно и без коалесинга инвалидировал 3 query key на каждое WS-событие, для каждого подписчика комнаты — при 10 активных pre-game комнатах на турнире 100 человек это давало наблюдаемые всплески ~200 rps. Разбор показал: (1) паттерн "патч вместо refetch" уже существует и доказан на балансер-драфте (`useDraftData.ts`, `registerRealtimeResource`/`applyResourcePatch`), но реализован там bespoke (~110 строк), не переиспользуемо; (2) четыре других realtime-топика (bracket, streams, logs, subscriptions) сегодня используют тот же thin-signal+refetch паттерн, местами с debounce (bracket, streams), местами вообще без него.

**Для кого.** Разработчики фич (новый realtime-топик подключается регистрацией ресурса + одним хуком, не написанием обвязки заново); зрители турнира (bracket/streams — публичные топики, потенциально сотни-тысячи подключений); капитаны/участники pregame (уже мигрировано отдельным треком, см. §4.5); админы воркспейса (logs/subscriptions — единицы-десятки подключений).

**Ключевые ограничения.**
- **Viewer-scoped поля никогда не транслируются сырыми.** `PickBanState.viewer_can_act`/`allowed_actions`/`viewer_side` — пример поля, вычисленного сервером ПОД конкретного зрителя (`build_pick_ban_state`, `pick_ban_action.py:194-195,203-204`); наивный broadcast такого поля всем подписчикам одного топика — дыра в правах, не косметика. Конвенция: публиковать нейтральный снапшот (`viewer_side=None`-паттерн, уже поддержан `get_pick_ban_state(..., viewer_side=None)`), клиент дочитывает свою идентичность локально (как `computeGating()` в `draft-logic.ts` уже делает для драфта).
- **Не все топики — хорошие кандидаты на "полный payload".** Bracket — САМЫЙ тяжёлый payload среди всех четырёх (весь список встреч турнира без пагинации, `per_page=-1`, `encounterService.getAll`) и публичный (аноним допущен) топик того же класса ACL, что и streams (`allowSpectateTournament`) — точное число одновременных подписчиков по bracket отдельно не измерялось, но природа топика (публичная страница турнира) даёт тот же порядок fan-out, что и у streams, для которого фан-аут явно задокументирован в `poller.py` ("hundreds of concurrent spectators on one topic"). Тяжёлый payload + публичный fan-out — худшая комбинация для WS push без батчинга/сжатия (`Hub.Route` шлёт байты в каждый сокет по отдельности). Его реальная сегодняшняя проблема (обычно 2, реже 3 волны рефетча на результат матча — см. §2) уже дёшево закрыта существующим debounce (250-2750мс джиттер, `useTournamentRealtime.ts`) + anonymous response cache гейтвея (30с TTL, `gateway/README.md`). Решение: bracket остаётся thin-signal, но переезжает на общую инфраструктуру (см. Decision D4).
- **Gateway payload-агностичен.** `Hub.Route(topic string, payload []byte, exclude *Conn)` (hub.go:177) и Redis fan-in `dispatch` (events.go:88-94) никогда не парсят содержимое события — только `topic` для роутинга. Значит рост payload'а НЕ добавляет сложности в Go-гейтвей ни на йоту — важный факт, снявший вопрос "не усложнит ли это gateway" без необходимости заводить отдельный сервис.
- **`realtime-service` уже был и его снесли.** Коммит `47b9203a feat(realtime): decommission realtime-service; gateway owns WebSockets` + `docker-compose.yml:136-140` — WS-транспорт сознательно консолидирован в Go-гейтвей. Исходный дизайн-док (`docs/superpowers/specs/2026-06-09-gateway-architecture-design.md`) прямо предлагал full-payload-push через `realtime-service` на Фазе 0 и в Фазе 4 сам же его удалял ("поглощён gateway"). Заводить отдельный сервис заново — откат уже принятого и обоснованного решения.
- **`realtime.workspace_event` — append-only, без retention.** Проверено (`grep purge/cleanup/retention` по всему backend) — ни одной job, чистящей эту таблицу. Аналогичный паттерн уже встречался в проекте (`workspace/service.py:564-566` — DNS verification journal, "never purged... would pile up forever").

**Non-goals.**
- Не трогаем сам транспорт (Go WS hub/protocol/replay) — он общий, payload-агностичен и достаточно ёмкий (per-topic concurrent fan-out, ACL, cursor-replay `WS_REPLAY_LIMIT=500`).
- Не создаём новый сервис — вся общая логика уходит в `backend/shared` (прецедент: generic pick-ban engine) + новый frontend-модуль.
- Не переписываем модель данных bracket'а под инкрементальные per-match дельты — bracket остаётся thin-signal (Decision D4).
- Codegen (D6) — вводим как возможность библиотеки, но не обязываем эту волну ей пользоваться: ни один из четырёх мигрируемых топиков не добавляет нового patch-payload типа (все остаются thin-signal, см. пересмотренную §4.4); первый реальный потребитель codegen и его CI-размещение — отдельное решение, когда появится следующий patch-ресурс.
- Не строим партиционирование `workspace_event` — при текущем объёме избыточно (см. §3).

## 2. Grounded facts (verified against source, this session)

### Транспорт (Go gateway)
- `gateway/internal/ws/hub.go:177-209` (`Hub.Route`) — рассылает подписчикам топика конкурентно (`safego.Go` на каждого), `sendTimeout = 2 * time.Second` (hub.go:16), payload — непрозрачные `[]byte`, гейтвей их не парсит.
- `gateway/internal/events/events.go` — один `Subscriber.consume()` на процесс, единая Redis `PSUBSCRIBE("realtime:*")`; `dispatch` тримит префикс канала и зовёт `hub.Broadcast(topic, payload)` без декода JSON.
- `gateway/internal/ws/topic.go:14-19` — `MaxClientFrameBytes = 8192` (входящие клиентские фреймы), `MaxPublishPerSecond = 60` (клиентские ephemeral-паблиши); **нет** серверного лимита на fan-out в топик — `Route` рассылает всем подписчикам без батчинга.
- `gateway/internal/replay/replay.go` — `EventsSince` реплеит `(after, upTo]` с `LIMIT` (`WS_REPLAY_LIMIT`, дефолт 500, `gateway/internal/config/config.go:209`); гэп больше лимита → `ErrGapTooLarge`, клиент падает на live-only (уже описано в `realtime.service.ts:288-298`, `sendSubscribe` шлёт `after_event_id`, только если для топика уже есть локальный курсор).
- `backend/shared/models/platform/realtime.py` — `WorkspaceEvent`: `id bigint PK`, `topic text`, `event_type varchar(128)`, `workspace_id/tournament_id/actor_user_id bigint nullable, indexed`, `schema_version smallint`, `payload JSONB NOT NULL` (без ограничения размера), `occurred_at timestamptz`. Индексы: `(topic, id)`, `(occurred_at)`. **Retention job отсутствует** (repo-wide grep на purge/cleanup/retention/delete-workspace_event — 0 совпадений в бэкенде).

### Bracket (`tournament:{id}:bracket`)
- Payload сегодня — `{"tournament_id": int, "reason": str}` (`realtime_commit.py:143-153`, `_build_realtime_event`), больше ничего.
- Публичный топик без ограничений: `gateway/internal/acl/acl.go:82` — `allowSpectateTournament` ("public unless hidden"), подтверждено тестами (`acl_test.go:74-99`).
- Рефетч по `bracket_changed` тянет **весь список встреч турнира без пагинации** — `encounterService.getAll(1, "", tournament.id, -1, ...)`, `per_page=-1` (`bracketData.ts:75-88`, `encounter.service.ts:58-81`).
- Один зафиксированный результат матча обычно порождает **2 волны**, реже 3 (`useTournamentRealtime.ts:32-42`): `bracket_changed` сразу (`events.py:46`), затем `results_changed` после завершения async standings-джобы (`computation/standings_worker.py:39`). Третья волна (`structure_changed`, `computation/bracket_worker.py:37`) условна — только когда та же джоба также ставит в очередь bracket-регенерацию (Swiss-раунд-граница или явная (пере)генерация стадии); обычный single/double-elimination результат её не вызывает.
- `structure_changed` (самая широкая причина) инвалидирует **до 14 разных query-key префиксов** суммарно на публичной+админской стороне (`tournamentRealtime.helpers.ts:126-241`: 8 публичных + 6 админских для scope=full — `logHistory` считается только при scope=results).
- Debounce уже есть: `createTrailingCoalescer`, окно `[250, 2750)` мс на клиента (`useTournamentRealtime.ts:43-49`) + leading catch-up коалесер 100мс на (пере)подписку.

### Streams (`tournament:{id}:streams`)
- Payload сегодня — `{"tournament_id": int, "live_count": int}` (`poller.py`, тест `test_poll_tick.py:244-247`).
- Не durable (`event_id=0`, без строки в `workspace_event`).
- Триггер — APScheduler тик, `interval_seconds` по умолчанию 60с (`StreamCollectionConfig`, `settings.py:85-96`); публикует, только если поменялся СОСТАВ live-каналов, не при изменении viewer_count (`poller.py:376-386`).
- Ответ, который рефетчится: `TournamentStreams {official: StreamEntry[], participants: StreamEntry[]}` (`stream.types.ts:61-69`), десятки записей, публичный эндпоинт (`skipWorkspace: true`).
- Fan-out публичный, тот же `allowSpectateTournament` ACL (`acl.go:87`); "hundreds of concurrent spectators on one topic" — прямая цитата из докстринга `poller.py`.

### Logs (`workspace:{id}:logs`)
- Payload — `{"workspace_id": int, "reason": str}` (`match_logs/realtime.py:29-44`).
- Триггер — событие обработки лога (успех/фейл/reaper-requeue), 3 call site'а (`serve.py:279,294`, `reaper.py:197`), не таймер.
- Рефетч — страница до 200 записей `LogProcessingRecord[]` (`admin.types.ts:1216-1237`, `/admin/logs/history`).
- Fan-out — воркспейс-админы, единицы-десятки, гейт `workspace:*:*` → `allowWorkspaceMember` (`acl.go:88`).
- Debounce уже есть (500мс, `TournamentLogsTab.tsx`).

### Subscriptions (`workspace:{id}:subscriptions`)
- Payload — `{"workspace_id": int, "reason": str}` (`subscription_realtime.py:51-81`).
- Триггер — один паблиш НА `SubscriptionResolver.resolve()` pass, независимо от того, сколько вердиктов внутри изменилось (докстринг: "sweep of 200 registrants flipping 40 verdicts folds into a SINGLE signal"). Расписание — раз в 30 мин по умолчанию (`SubscriptionCollectionConfig.interval_seconds=1800`) + ad-hoc (регистрация/чек-ин/redeem).
- Два независимых фронтенд-консьюмера с разными инвалидациями: admin-страница (весь префикс `["admin","subscriptions"]`) и `TournamentHubShell` (`registrationsList`).
- Fan-out — воркспейс-админы, тот же `workspace:*:*` гейт, не публичный.

### Уже существующий (единственный) прецедент patch-режима — драфт
- `publish_draft_event` → `publish_patch(..., resource=DRAFT_BOARD_RESOURCE, ...)` (`backend/balancer-service/src/services/draft/realtime.py`).
- `registerRealtimeResource(DRAFT_BOARD_RESOURCE, applyDraftEvents)` (`useDraftData.ts:56-58`), `applyResourcePatch` (`realtime-patch.ts:49-64`) — patch-или-uncached-fallback уже реализован, но inline в `useDraftRealtime` (~110 строк), не вынесен в переиспользуемый хук.

## 3. Assumptions (non-functional)

| Область | Допущение |
|---|---|
| Масштаб | Тот же порядок, что и сегодня — десятки турниров, bracket/streams — сотни-тысячи анонимных подписчиков на топик в пике; logs/subscriptions — единицы-десятки. Новый класс инфраструктуры не нужен. |
| Производительность | В этой волне НИ ОДИН из четырёх топиков не переходит на patch-режим (см. пересмотр streams в §7, Phase 2.2) — все получают механический перевод на общий thin-signal примитив с существующими debounce-параметрами. Patch-примитив строится и остаётся доступен библиотеке (уже используется драфтом и отдельно одобренным pregame-треком), но не обязателен для этой миграции. Партиционирование `workspace_event` не нужно при текущем объёме (аналог — `2026-08-12-platform-audit-log-design.md`). |
| Надёжность | Durability по топику (D1): bracket/pregame/draft уже durable, остаются; streams/logs/subscriptions остаются non-durable — их докстринги уже объясняют это осознанным выбором. Retention (D2, пересмотрено в Phase 2.2) применяется ТОЛЬКО к bracket — pregame/draft-сессии не имеют верхней границы длительности, и 7-дневное окно могло бы вычистить историю ещё открытой сессии; это отдельный вопрос, не решаемый в этой волне. Reconnect-safety-net (§4.3) идёт через существующее джиттер-окно коалесера, не bypass'ит его — иначе реконнект после рестарта gateway (все сокеты падают разом, backoff без джиттера, `realtime.service.ts`) сам стал бы синхронизированным штормом. |
| Безопасность | Viewer-scoped поля никогда не в broadcast-payload — обязательное правило конвенции регистрации ресурса (см. §1). |
| Сопровождение | Одна библиотека, два примитива (patch / thin-signal), общий транспорт и общие коалесеры. Codegen для НОВЫХ ресурсов; существующие ручные типы не трогаем. |

## 4. Design

### 4.1 Архитектурное решение — Вариант A: два сфокусированных примитива на общей инфраструктуре

Рассмотрено и отклонено:
- **Вариант B** (один хук с `mode: "patch"|"thin"`) — меньше публичных имён, но хук ветвится на два несвязанных поведения внутри; сложнее читать/тестировать/трейсить, не даёт ничего сверх A кроме нейминга.
- **Вариант C** (декларативный resource-descriptor / конфиг-объект на топик, единый рантайм-интерпретатор) — преждевременная абстракция: у нас ровно 2 режима сегодня, третий не просматривается; конфиг прячет поток управления ради гипотетической гибкости, которую никто не просил.

**Принято: Вариант A.**

### 4.2 Backend

**Не меняется:** `backend/shared/services/realtime_publisher.py` (`publish_event`, `publish_patch`) — уже общие примитивы. **Важно:** и `publish_event`, и `publish_patch` ВСЕГДА персистят `WorkspaceEvent` (durable). Non-durable топик (streams/logs/subscriptions) публикует напрямую через `publish_envelope_to_redis` с `event_id=0` — тем же путём, что и сегодня, без изменений: ни один из них не входит в эту волну на patch-режиме (см. §4.4), так что их backend-паблишеры не трогаются вовсе.

**Новое:** `backend/shared/services/realtime_transaction.py` — фабрика transactional staging, обобщающая **дублирующийся сегодня** код (`tournament/realtime_commit.py` и `encounter/realtime_commit.py`). Сигнатура синхронная, без async-колбэка (снапшот, если он вообще нужен, строится в асинхронном коде вызывающей стороны ДО стейджинга — как у pregame):

```python
def register_realtime_update(
    session: Any,
    *,
    key: tuple,             # напр. (tournament_id, reason) или (encounter_id, kind)
    event_type: str,
    payload: dict[str, Any] | None = None,  # уже построенный ПОЛНЫЙ снапшот, или None для thin-signal
) -> None:
    """Синхронный stage-вызов. `payload`, если задан, ДОЛЖЕН быть полным
    снапшотом ресурса, не дельтой — повторный вызов с тем же `key` в одной
    транзакции ПЕРЕЗАПИСЫВАЕТ payload целиком (последний снапшот побеждает).
    Ресурс, которому нужно копить/мёржить несколько дельт в рамках одной
    транзакции до commit, не подходит для этой last-write-wins семантики —
    такой мёрж делает вызывающая сторона сама, до вызова этой функции.
    """
```

Оба существующих модуля рефакторятся НА эту фабрику — чистка дублирования, не новая фича. Bracket остаётся thin-signal (`payload=None`).

**Snapshot-builders.** Обязательное правило конвенции для БУДУЩЕГО patch-ресурса: сигнатура snapshot-builder'а не принимает `user`/`viewer`/`auth`-параметр (если функции физически неоткуда взять зрителя, она структурно не может утечь viewer-scoped поле) — прецедент `get_pick_ban_state(session, encounter_id, kind, viewer_side=None)`. Эта волна не добавляет НИ ОДНОГО нового snapshot-builder'а (streams пересмотрен обратно в thin-signal, см. §7 Phase 2.2) — правило фиксируется для следующего patch-ресурса, не применяется здесь.

**Retention:** новая джоба в уже существующем `AsyncIOScheduler` `tournament-service` (`serve.py`, рядом с `drain_outbox`/`auto_transition_tournaments`), **только для bracket** (пересмотрено в Phase 2.2 — pregame/draft-топики исключены, см. §3/Надёжность):
```python
scheduler.add_job(purge_stale_bracket_events, "interval", days=1, id="bracket_workspace_event_purge")
```
`DELETE FROM realtime.workspace_event WHERE topic LIKE 'tournament:%:bracket' AND occurred_at < now() - interval '7 days'` — **один DELETE, без батчинга** (пересмотрено в Phase 2.2: батчированный LIMIT+loop был сложнее, чем цитируемый прецедент `2026-08-12-platform-audit-log-design.md`'s "один DELETE", без реальной причины при таком суженном объёме — bracket-only заметно меньше, чем "все durable топики" из первой версии), по существующему индексу `ix_realtime_workspace_event_occurred_at`, без нового индекса, без партиционирования.

### 4.3 Frontend

**Не меняется:** `hooks/useRealtimeTopic.ts` (транспортный примитив), `services/realtime.service.ts`, `services/realtime-patch.ts`.

**Новое:** `hooks/useRealtimePatchedQuery.ts` — patch-примитив (уже есть потребители: драфт, отдельно одобренный pregame-трек; эта волна его не расширяет):
```ts
useRealtimePatchedQuery<TSnapshot, TData>(topic, { resource: string, queryKey: QueryKey })
```
Оборачивает: subscribe → `applyResourcePatch` → invalidate только на `"uncached"`/`"unregistered"`. **Reconnect safety-net** (после Phase 2.1): на переходе `reconnecting → connected` хук ПЛАНИРУЕТ (не выполняет немедленно) refetch через тот же jittered-коалесер, что и обычные события — не bypass'ит джиттер. Immediate/bypassing вариант создал бы синхронизированный refetch-шторм именно в момент реконнекта после общего сбоя (все сокеты падают разом при рестарте gateway, `realtime.service.ts`'s backoff — `RECONNECT_BASE_MS`/`RECONNECT_MAX_MS` — без джиттера), что Constraint Guardian верно указал как регресс к тому самому шторму, который джиттер должен предотвращать (Phase 2.2, объекция №1).

**Новое:** `hooks/useRealtimeCoalescedRefetch.ts` — thin-signal примитив, обобщающий debounce+jitter+severity-merge логику, продублированную сегодня между `useTournamentRealtime.ts` и `useTournamentStreamRealtime.ts`, и параметризуемый **по топику** (Constraint Guardian, объекция №5: bracket — `[250,2750)`мс джиттер + 100мс leading catch-up; streams — те же параметры, что у него уже есть сегодня; logs/admin-subscriptions — фиксированные 500мс; hub-subscriptions — near-zero/pass-through, без коалесинга, как сегодня). Тот же безусловный-но-джиттеренный reconnect-refetch, что и у `useRealtimePatchedQuery`. `useTournamentRealtime`/`useTournamentStreamRealtime` переписываются на этот хук со своими текущими параметрами — чистка дублирования, поведение не меняется.

**Новое:** `lib/realtime-coalesce.ts` — `createLeadingCoalescer`/`createTrailingCoalescer` переезжают сюда из `tournamentRealtime.helpers.ts`.

**Codegen:** механизм (Pydantic `model_json_schema()` → `json-schema-to-typescript`) описывается как возможность библиотеки для БУДУЩЕГО patch-ресурса — не строится как часть этой волны, поскольку она не вводит ни одного нового payload-типа (см. пересмотренную матрицу §4.4). Размещение CI-проверки (`ci-frontend.yml` path-filtered на `frontend/**`, не видит backend-schema-change; `test-backend.yml` без Node/bun toolchain — ни один из двух не подходит как есть, Constraint Guardian объекция №10) решается вместе с первым реальным потребителем, не заранее.

### 4.4 Матрица миграции по топикам

**Пересмотрено в Phase 2.2 (Constraint Guardian).** Изначальный план ставил streams на patch/snapshot-режим; проверка показала три независимых довода против: (1) `TournamentStreamsReader.build` делает per-tournament запросы, тогда как тикер (`poller.py`) специально построен вокруг батчинга — patch-режим откатил бы именно эту оптимизацию; (2) заявленный "payload мал" не выдержал сравнения — замена 2-скалярного сигнала на `TournamentStreams{official, participants}` с полными `StreamEntry` (включая вложенный `player`/`team`) на порядок больше, при том же большом fan-out; (3) собственный докстринг `useTournamentStreamRealtime.ts` уже explicitly объясняет, почему patch там не нужен ("plain refetch of one small key is cheaper than maintaining a reducer that would have to refetch anyway") — довод, который первая версия этого документа не опровергла. Все четыре топика остаются на thin-signal.

| Топик | Режим | Payload | Коалесинг |
|---|---|---|---|
| bracket | thin | без изменений | `[250,2750)`мс джиттер + 100мс leading catch-up (как сегодня) |
| streams | thin | без изменений | те же параметры, что у `useTournamentStreamRealtime` сегодня |
| subscriptions (admin) | thin | без изменений | 500мс фиксированный (как сегодня) |
| subscriptions (hub) | thin | без изменений | без коалесинга — pass-through (как сегодня) |
| logs | thin | без изменений | 500мс фиксированный (как сегодня) |

Все четыре — механический перевод на общий `useRealtimeCoalescedRefetch` с сохранением текущих параметров и поведения; ни один backend-паблишер не меняется. Patch-примитив (`useRealtimePatchedQuery`) в этой волне не используется ни одним из четырёх — он уже проверен драфтом и отдельно одобренным pregame-треком, и остаётся доступен библиотеке для следующего кандидата.

### 4.5 Ссылка на уже реализованный трек

Pregame pick-ban (encounter `map-veto`/`pick-ban:hero` топики) мигрирован на patch-режим отдельным, уже спроектированным треком (см. предыдущую сессию проектирования в этом же потоке работы): `register_map_veto_realtime_update` становится `async`, встраивает нейтральный `PickBanState`-снапшот (`viewer_side=None`) через `get_pick_ban_state`, `PregameRoom`/`PickBanPanel` дочитывают `viewer_can_act`/`allowed_actions` локально из `roleQuery`. Использует те же примитивы (`useRealtimePatchedQuery`, `registerRealtimeResource`), что и настоящий документ проектирует для остальных топиков — единая библиотека закрывает оба трека.

### 4.6 UX: индикатор состояния соединения (добавлено после User Advocate-ревью, см. §8)

Драфт/pregame уже показывают явный индикатор `connectionState` (`idle`/`connecting`/`connected`/`reconnecting`) — `DraftPageHero.tsx` (`t('connection.${connectionState}')` + иконка), поверх того же `useRealtimeStore`, который использует и эта библиотека. Bracket/streams/logs/subscriptions сегодня НЕ показывают ничего — страница выглядит одинаково и при живом соединении, и при тихо оборвавшемся сокете. Раз эта работа в любом случае трогает все четыре поверхности и общий примитив, к которому они переходят, — расширяем существующий (не новый) паттерн на bracket-страницу и стрим-секцию: тот же `t('connection.*')` + иконка, тот же источник данных (`useRealtimeStore().connectionState`), без нового UI-языка. Admin-поверхности (logs/subscriptions) — низкий приоритет: маленькая аудитория, уже есть explicit кнопка ручного рефреша (см. Review Log, объекция №7).

Не в скоупе этой волны (осознанно, см. Review Log §8): (а) поведение polling-фолбэка bracket'а вне статусов `live`/`playoffs` — существует независимо от режима доставки, не создано и не устранено этой миграцией; (б) паттерн "показать, что данные потенциально устарели" для БУДУЩЕГО patch-ресурса, чей reducer не зарегистрирован/не сработал — сегодня в кодовой базе такого паттерна нет вообще (единственный error-UI, `TournamentPageState.tsx`'s refresh-error banner, реагирует только на реально упавший HTTP-фетч, не на тихо деградировавший WS) — фиксируется как открытый вопрос для того, кто добавит следующий patch-ресурс.

## 5. Decision Log

| # | Решение | Альтернативы рассмотрены | Почему выбрано |
|---|---|---|---|
| D1 | Durability решается **по топику** — bracket/pregame/draft (уже durable) остаются; streams/logs/subscriptions остаются **non-durable** — **пересмотрено после Skeptic-объекции №3**, было "все durable" | Все топики durable (унификация) | Собственные докстринги `logs`/`subscriptions`/`streams` уже объясняют non-durability как осознанный выбор ("реконнект = рефетч, персистить нечего/незачем") — блочная унификация отменяла бы это обоснование без нового аргумента, который бы его перевешивал |
| D2 | Retention — ежедневная джоба, единый (не батчированный) `DELETE ... WHERE occurred_at < now() - 7d`, **только для bracket** (пересмотрено в Phase 2.2, было "все durable топики" + батч-цикл) | Недельный батч; партиционирование; батчированный LIMIT+loop | Партиционирование — over-engineering при объёме одного топика; batching был сложнее цитируемого прецедента без причины при таком суженном скоупе. Pregame/draft исключены из retention — см. D10 |
| D3 | Общий код — библиотека в `backend/shared` + новый frontend-модуль, БЕЗ нового сервиса | Возродить `realtime-service` | `47b9203a` уже decommissioned его именно ради консолидации в gateway; gateway payload-агностичен (`Route(topic, []byte, ...)`), богатый payload не требует нового сервиса; исходный gateway-design-doc (`2026-06-09`) сам предлагал и сам же отменил full-payload-push через отдельный сервис |
| D4 | Bracket остаётся thin-signal, НЕ становится snapshot/delta-patch топиком | Delta per match | Худшая комбинация payload×fan-out среди всех четырёх; respcache+debounce уже дёшево закрывают его реальную проблему |
| D5 | Все 4 топика мигрируют на общий thin-signal примитив в одну волну | Только streams в v1; смешанный patch+thin по топикам | После Phase 2.2 все четыре остаются thin-signal (механический перевод, ни одного нового поведенческого контура) — риск волны равномерно низкий |
| D6 | Codegen (Pydantic JSON Schema → TS) — возможность библиотеки, не обязательство этой волны | Строить сразу и для этой волны | Эта волна не вводит новых patch-payload типов (streams возвращён в thin-signal, D8) — codegen и его CI-размещение решаются с первым реальным patch-ресурсом |
| D7 | Архитектура библиотеки — два примитива (`patch` + `thin-signal`) на общем транспорте/коалесерах | Единый хук с `mode`; декларативный resource-descriptor | Минимальная абстракция, соответствующая ровно двум существующим режимам; попутно устраняет реальное дублирование (`realtime_commit.py`×2, debounce-логика×2) |
| D8 | Streams остаётся thin-signal, НЕ становится patch/snapshot топиком — **пересмотрено в Phase 2.2**, было "patch, высокий приоритет" | Patch с полным снапшотом `TournamentStreams` | `TournamentStreamsReader.build` делает per-tournament запросы, откатывая батчинг, вокруг которого построен `poller.py`; заявленный "малый payload" на порядок меньше реального (`TournamentStreams{official,participants}` с вложенными `player`/`team` против 2 скаляров сегодня); `useTournamentStreamRealtime.ts`'s собственный докстринг уже объяснял, почему patch там не нужен, и первая версия документа это не опровергла |
| D9 | Reconnect-refetch safety-net (§4.3) идёт через существующий jittered-коалесер, не bypass'ит его немедленным вызовом | Немедленный безусловный invalidate на reconnect (первая версия) | Immediate-вариант создавал бы синхронизированный refetch-шторм именно на массовом реконнекте после сбоя gateway (все сокеты падают разом, backoff без джиттера) — регресс к тому самому шторму, который джиттер должен предотвращать |
| D10 | Retention (D2) применяется только к bracket, НЕ к pregame/draft | Retention для всех durable-топиков (первая версия) | Pregame/draft-сессии не имеют верхней границы длительности — 7-дневное окно могло бы вычистить историю ещё открытой сессии. Отдельный вопрос архивации сессий вне скоупа этой волны |
| D11 | Индикатор `connectionState` (переиспользующий паттерн `DraftPageHero.tsx`) добавляется на bracket-страницу и стрим-секцию | Оставить без индикатора (как сегодня); добавить на все 4 поверхности сразу | User Advocate: та же инфраструктура (`useRealtimeStore`) уже даёт этот сигнал на draft/pregame, но не на остальных — несогласованность доверия пользователя к "страница скажет, если что-то не так". Admin-поверхности (logs/subscriptions) — не первый приоритет: маленькая аудитория, есть ручной рефреш |

## 6. Review Log — Phase 2.1: Skeptic / Challenger

Полная объекция сохранена в `agent://SkepticReview` (сессионный артефакт). Свод и резолюции:

| # | Объекция (кратко) | Severity | Резолюция |
|---|---|---|---|
| 1-2 | `register_realtime_update`'s async-колбэк внутри sync `before_flush` — тот же конфликт, что уже решался для pregame | Blocker | **Принято.** Сигнатура переделана на синхронную, принимающую уже построенный payload (§4.2); снапшот строится вызывающей стороной до стейджинга, как у pregame |
| 3 | D1 "все durable" отменяет explicit non-durability rationale в докстрингах logs/subscriptions/streams без контраргумента | Significant | **Принято.** D1 пересмотрено — durability по топику (§5) |
| 4-5 | Subscriptions-дельта на коарс-гейте `workspace:*:*` вместо узкого `subscription.read`; durable-персист вердиктов на 7д там, где код explicitly спроектирован "nothing to leak" | Blocker | **Принято.** Subscriptions возвращён в thin-signal (§4.4), объекция снята вместе с причиной (нет payload — нечего утечь) |
| 6, 15 | Retention (D2) маскирует `ErrGapTooLarge` для клиента с гэпом старше окна ротации | Significant | **Принято.** Обязательный безусловный reconnect-refetch в обоих frontend-примитивах (§4.3) как defense-in-depth, независимый от результата replay |
| 7-8 | Точечный patch логов не покрывает "запись перестала попадать под фильтр" (видимо-неверная строка, не просто stale); чистая liveness-регрессия против текущего thin-signal | Significant | **Принято.** Logs возвращён в thin-signal (§4.4) |
| 9 | Subscriptions-дельта без версионирования — гонка двух независимых паблишеров может откатить кэш к более старому вердикту | Significant | **Снято резолюцией №4-5** (subscriptions больше не patch-топик) |
| 10 | "Viewer-scoped поля не транслируются" — только прозаическая конвенция, без enforcement; codegen снижает трение для нарушения | Significant | **Принято.** Добавлено структурное правило: snapshot-builder не принимает `user`/`viewer`/`auth`-параметр (§4.2) |
| 11 | Цитата про fan-out bracket'а на самом деле про streams (`poller.py`) | Minor | **Принято.** Формулировка исправлена (§1), вывод (D4) не меняется |
| 12 | "2-3 волны" завышает типичный случай — 3-я волна условна (Swiss/bracket-regen) | Minor | **Принято.** Формулировка исправлена (§2), вывод не меняется |
| 13 | "До 15" query-key префиксов — пересчёт даёт 14 | Minor | **Принято.** Число исправлено (§2) |
| 14 | D5 (все 4 сразу) объединяет топики с разным уровнем риска без явного взвешивания | Minor | **Снято, обновлено после Phase 2.2.** После пересмотра streams (D8) все четыре топика остаются thin-signal — риск волны равномерно низкий, объекция сильнее закрыта, чем изначально заявлено в этой строке |

## 7. Review Log — Phase 2.2: Constraint Guardian

Полная объекция сохранена в `agent://ConstraintGuardianReview`. Свод и резолюции:

| # | Объекция (кратко) | Axis | Severity | Резолюция |
|---|---|---|---|---|
| 1 | Immediate reconnect-refetch (Phase 2.1 fix) сам создаёт синхронизированный refetch-шторм на массовом реконнекте (gateway restart роняет все сокеты разом, backoff без джиттера) | Performance/Reliability | Significant | **Принято.** D9 — refetch идёт через существующий jittered-коалесер, не bypass |
| 2 | `register_realtime_update`'s `payload` не различает snapshot и delta — латентный риск для будущего consumer'а, который захочет копить дельты в одной транзакции | Reliability/Maintainability | Significant (латентно) | **Принято.** Докстринг явно требует ПОЛНЫЙ снапшот, запрещает delta-под-last-write-wins; мёрж дельт — забота вызывающей стороны (§4.2) |
| 3 | `TournamentStreamsReader.build` делает per-tournament запросы, откатывая батчинг `poller.py`'s `_build_plans` | Performance/Scalability | Significant | **Принято.** D8 — streams остаётся thin-signal, вопрос снят вместе с patch-режимом для него |
| 4 | DB-зависимый snapshot-build в publish-пути поллера меняет failure-семантику (может проглотить WS-сигнал при DB-сбое, хотя Redis-состояние уже записано) | Reliability | Significant | **Снято резолюцией по №3** (streams не строит снапшот вовсе) |
| 5 | Один `useRealtimeCoalescedRefetch` для bracket/logs/subscriptions(×2)/streams без параметризации — у них разные существующие debounce-профили (джиттер / фиксированные 500мс / без коалесинга вовсе) | Maintainability/Performance | Significant | **Принято.** Хук явно параметризуется по топику, каждый сохраняет свои текущие параметры (§4.3, §4.4) |
| 6 | "Payload мал" для streams не сайзился против реальной замены — на порядок больше 2-скалярного сигнала | Performance/Scalability | Minor-to-Significant | **Принято, объединено с №3** (D8) |
| 7 | Retention (bracket/pregame/draft) мог вычистить историю ещё открытой draft/pregame-сессии — ни у одной нет верхней границы длительности | Reliability/Operational-cost | Significant | **Принято.** D10 — retention сужен до bracket |
| 8 | Провал daily-джобы не совсем "тихий" (Sentry через `observe_scheduled_job`), но фиксированный 24ч интервал даёт ~48ч непочищенного роста на один сбой | Reliability/Operational-cost | Minor | **Принято к сведению.** Скоуп уже сужен до bracket-only (D10) — блэст-радиус одного пропуска мал; отдельного алертинга не заводим |
| 9 | Батчированный LIMIT+loop сложнее цитируемого прецедента ("один DELETE"), не специфицирован по batch-size/commit-границам, потенциальная конкуренция за пул с `drain_outbox` (1с интервал) | Maintainability/Operational-cost/Performance | Minor-to-Significant | **Принято.** D2 — вернулись к единому DELETE без батчинга, как в цитируемом прецеденте, раз объём (bracket-only) это позволяет |
| 10 | CI-проверка codegen-дрифта не размещена ни в одном существующем workflow (`ci-frontend.yml` — path-filtered, не видит backend; `test-backend.yml` — без Node-тулчейна); новая зависимость `json-schema-to-typescript` не сайзена | Maintainability/Operational-cost | Significant | **Принято.** D6 — codegen откладывается до первого реального patch-ресурса этой волны нет, специфицировать CI не для чего |

## 8. Review Log — Phase 2.3: User Advocate

Полная объекция сохранена в `agent://UserAdvocateReview`. Свод и резолюции:

| # | Объекция (кратко) | Население | Severity | Резолюция |
|---|---|---|---|---|
| 1, 7, 8 | Нет индикатора `connectionState` на bracket/streams/logs/subscriptions, хотя тот же примитив уже даёт такой сигнал на draft/pregame (`DraftPageHero.tsx`) — несогласованность доверия между поверхностями одного продукта | Аноним-зрители (значимо), админы (мало) | Significant | **Принято.** D11 — индикатор расширяется на bracket/streams (§4.6); admin-поверхности — низкий приоритет |
| 2 | Джиттер-окно реконнекта (до 2750мс) поверх backoff (до 30с) невидимо зрителю, только что посмотревшему конец матча | Аноним-зрители | Significant | **Принято частично.** Индикатор (D11) делает состояние "reconnecting" видимым; сам факт задержки после reconnect — осознанный компромисс (защита от синхронизированного шторма, D9), не меняется |
| 3 | Polling-фолбэк bracket'а есть только для статусов `live`/`playoffs` — вне них тихий обрыв WS не компенсируется ничем | Аноним-зрители | Significant | **Принято к сведению, вне скоупа.** Существующее поведение, не создано и не устраняется этой миграцией — зафиксировано как известное ограничение (§4.6) |
| 4 | Логи: спиннер не различает "событие не приходило" и "событие пришло, но под фильтр не попало" | Админы | Minor | **Принято к сведению, вне скоупа.** Подтверждено: серверная переоценка фильтра при рефетче работает корректно (объекция Skeptic №7-8 сюда не возвращается) — только отсутствует affordance, что рефетч вообще случился |
| 5 | Pre-existing дрейф offset-пагинации в логах (новая запись в голове списка может вытолкнуть просматриваемую строку за пределы уже открытых страниц) | Админы | Minor | **Принято к сведению, вне скоупа.** Существует независимо от режима доставки (thin-signal и до, и после этой работы) |
| 6 | Hub-страница подписок — без коалесинга вовсе, immediate reflow при каждом вердикте, в отличие от admin-страницы (500мс) | Капитаны/участники | Minor | **Принято к сведению, вне скоупа.** Существующая асимметрия, не создана этой миграцией (§4.4 сохраняет её как есть) |
| 9 | Нет никакой конвенции "показать возможно устаревшие данные" для будущего patch-ресурса, чей reducer не сработал/не зарегистрирован — единственный error-UI реагирует только на упавший HTTP-фетч, не на тихо деградировавший WS | Все, forward-looking | Significant (для будущего) | **Принято как открытый вопрос.** Зафиксировано в §4.6 как то, что должен решить следующий patch-ресурс — не изобретается спекулятивно сейчас (в этой волне нет ни одного нового patch-ресурса) |

## 9. Arbitration (Phase 3)

Полный отчёт — `agent://ObligedSeahorse`. Все 5 exit-критериев `multi-agent-brainstorming` выполнены: Understanding Lock завершён (§1-§3, предшествует всем трём раундам ревью); все три ревьюера вызваны (§6/§7/§8); все объекции разрешены или явно отклонены с обоснованием (38 объекций, ни одна не потеряна между раундами); Decision Log полон (D1-D11, каждое решение трассируется к породившей его объекции). Арбитраж нашёл 4 расхождения между текстом §1/§6 и фактическим финальным состоянием дизайна (все — текстовые: рассинхрон "3 vs 4 топика", битая ссылка `§5.4`→`§4.5`, устаревшая формулировка резолюции объекции №14, заголовок/лид, всё ещё продававший patch как хедлайн после того как streams тоже вернулся к thin-signal) — исправлены выше, ни одно не потребовало нового технического решения или четвёртого раунда ревью.

**Disposition: APPROVED.**

## 10. Next steps

Дизайн одобрен — готов implementation-план: (1) `backend/shared/services/realtime_transaction.py` (фабрика) + рефакторинг `tournament/realtime_commit.py`/`encounter/realtime_commit.py` на неё; (2) `hooks/useRealtimeCoalescedRefetch.ts` + `lib/realtime-coalesce.ts` (перенос коалесеров) + рефакторинг `useTournamentRealtime`/`useTournamentStreamRealtime`/`TournamentLogsTab`/subscriptions-консьюмеров на общий хук с сохранением текущих параметров; (3) `hooks/useRealtimePatchedQuery.ts` (используется уже одобренным pregame-треком); (4) indicator из §4.6 на bracket/streams; (5) retention-джоба (bracket-only, §4.2). Тесты — на паритет поведения (0 изменений в payload/debounce-параметрах для всех четырёх топиков) и на новый indicator.
