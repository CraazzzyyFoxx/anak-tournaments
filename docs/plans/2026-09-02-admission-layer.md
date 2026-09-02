# Единый слой допуска (admission)

Дата: 2026-09-02
Статус: **выполнено, Ф0–Ф5.**
Миграции: **0**

## 0. Прогресс

### Ф0 — готово

Ядро на месте и покрыто тестами (77 passed, БД не нужна):

| Файл | Что |
|---|---|
| `shared/services/admission/types.py` | словарь: `RequirementState`, `AdmissionStage`, `AdmissionDecision`, `ReasonActor`, `AdmissionReason`, `RequirementVerdict`, `AdmissionEvaluation`, `Requirement` |
| `shared/services/admission/reasons.py` | `REASON_ACTORS` (24 кода), `actor_for`, `reason` |
| `shared/services/admission/signals.py` | `AdmissionSignals`, `ProfileSignal`, `SubscriptionSignal`; `ready` как property |
| `shared/services/admission/config.py` | `AdmissionConfig.from_form` — defensive `getattr`, неизвестная стадия → `check_in` |
| `shared/services/admission/evaluate.py` | чистая `evaluate(config, signals, *, stage, requirements)` + `blocks_at`; `_STAGE_RANK` вместо сравнения enum'ов (`"check_in" < "registration"` алфавитно — то есть наоборот) |
| `shared/services/admission/registry.py` | `REQUIREMENTS`; единственный читатель `subscription_stage` |
| `shared/services/admission/requirements/open_profile.py` | `eval_open_profile` |
| `shared/services/admission/requirements/subscription.py` | `eval_subscription`, `build_subscription_signal` |

Инварианты закреплены именованными тестами: fail-open (3 состояния × 2 стадии
требования × 2 гейта, каждая ячейка с non-vacuity компаньоном), D2
(`checked_in ∧ blocked → admitted`), порядок стадий, `not_applicable` не
вычисляется но остаётся в `requirements`.

### Ф1 — готово

`resolve_profiles_open` возвращает `dict[int, ProfileSignal]` с причинами. Тело
переписано (причина терялась внутри цикла), батч-`SELECT` и precedence сохранены —
закреплено дифференциальным тестом на 584 комбинациях тегов против восстановленного
с нуля старого правила.

`shared/services/admission/resolve.py` — весь I/O, две точки входа:

| Функция | force | source | Кто |
|---|---|---|---|
| `resolve_admission(session, registrations, *, config, resolver, stage=check_in)` | нет | `scheduled` | списки участников, админская таблица |
| `resolve_admission_for_gate(session, registration, *, config, resolver, stage)` | **да** | из стадии | гейты |

Разделение **не по стадии.** Первоначальный набросок выводил `force_refresh` из
стадии — это было неверно: страница участников и гейт чек-ина спрашивают про **ту
же** стадию и обязаны вести себя по-разному, потому что разница в «я решаю или
показываю». Булев параметр на одной функции поставил бы два поведения в одну опечатку
друг от друга на каждом вызове.

`AdmissionConfig` получил `workspace_id` — без него `resolver.evaluate` не вызвать.
`enforces_subscription` теперь требует все три условия; `assert`-ы из production-пути
убраны (вырезаются под `-O`, оставляя `None` в качестве workspace id).

Закреплено 13 тестами: батч-контракт (20 регистраций = 1 профильный `SELECT`,
1 маппинг auth-id, 1 проход резолвера), матрица force/source, смягчение
challenge-кодом только на регистрации и только на `REFUSED`, ноль запросов когда
оба требования выключены.

### Ф2 — готово

`shared/services/admission/gates.py` — `assert_admitted(evaluation, *, stage, config=None)`
кидает через существующую конвенцию `ApiHTTPException(detail=[ApiExc(msg, code)])`,
по одному `ApiExc` на блокер, `code` = код причины. `config` опционален и влияет
**только на текст**: `describe_requirement` нужен `SubscriptionRequirement`, а
`AdmissionEvaluation` его не несёт (в `detail` есть провайдеры, но не `mode` и не
пороги тиров). Без конфига гейт всё равно отказывает — теряется только имя правила.

`tournament-service/.../admission.py` — `load_admission_config`, `assert_admitted_at`,
`build_admission_resolver`. Одна точка, где write-path спрашивает про допуск.

`subscription_gate.py` **удалён целиком.** `describe_requirement` переехал в
`gates.py`, `enforces_at_registration` стал `AdmissionConfig.from_form(form).subscription_stage`,
остальное — `assert_admitted`. Инлайн-проверка профиля в `public_rpc.py` удалена:
профиль теперь элемент реестра. Три гейтовых сайта заменены на один вызов каждый.
Два устаревших тест-файла удалены, их четыре поведения перезакреплены.

Админский `_reg_check_in` остался **без** гейта — это заявленный override, и
`overridden` делает его результат видимым. Параметр `override=True` не добавлен:
параметр, единственная задача которого — пропустить вызов, это тот же вызов дважды.

### Ф3 — готово

`resolve_admission_signals` → `resolve_admission_list`, возвращает
`dict[int, AdmissionEvaluation]`. Временный шов, терявший причины, удалён.

`AdmissionChips.of(evaluation)` (`registration_build.py`) — единственная проекция,
через которую идут **все** три чтения (публичный список, админская таблица,
карточка самого игрока). Чипы `profiles_open` / `subscription_outcome` /
`subscription_verdicts` поднимаются из `requirements[].detail`, а не резолвятся
вторично. Выключенное требование даёт `None`, а не `{}` — иначе клиент рисует
пустую колонку вместо отсутствующей.

D14 закрыт: `serialize_verdicts`, `build_subscription_reads`, `RegistrationSubscription`,
`SubscriptionReadsService` удалены. Дубль читателя формы сведён к одной реализации.

### Ф4 — готово

Удалены все пять копий правила плюс шестая, которую нашли по ходу:
`balancer_status === "ready"` в карточке игрока (расходилась с сервером для
игрока с ранком, но ещё не approved — теперь `admission.ready`, D3).

`src/lib/admission.ts` — проекции (`ADMISSION_ORDER`, `ADMISSION_SEARCH_TEXT`,
`tallyAdmissionReasons`, `activeRequirements`, `primaryAdmissionReason`). Живут
там, потому что до них дотягиваются все три потребителя, а `registrationGrouping`
не должен импортировать компонент.

`AdmissionStatusBadge` ужался с 8 пропсов до 2. Колонка `Reason` + агрегат по
всему пулу, отсортированный organizer → system → player, с маркером на
organizer-строках. Шаги игрока — один `map` по `requirements`. i18n на 25 кодов
в обоих языках.

Маркер override: `decision=admitted` + непустой `overridden` → тон остаётся
**положительным** (амбер отправил бы организатора разбираться со строкой, где
делать нечего), aria-label — нейтральный «requirement unmet, admission already
granted».

Чипы (`SubscriptionStatusBadge`, колонка Profile) сохранили свои сравнения с
сырыми сигналами — это рендер **сигнала**, не решения. Три состояния подписки
обязаны отличаться: аутейдж, выглядящий как отказ, — ровно тот failure mode,
против которого существует fail-open.

### Ф5 — готово

Свернулась в основном попутно: `RegistrationBadges.behavior.test.tsx` и
`registrationGrouping.test.ts` переписаны как тесты **проекции** («тот же
`decision` на входе → тот же ярлык на выходе»), а не правила; два бэкендных
per-copy набора удалены Ф2 с перезакреплением поведений в
`test_admission_gate_wiring.py`. Таблица на ядро — `test_admission_evaluate.py`
(полная матрица состояние × стадия × гейт с non-vacuity-компаньонами).
Интеграционные оставлены: они проверяют I/O.

Страж i18n на месте (`src/lib/admission.test.ts`): ключи `admission.reason.*`
сверяются с `ADMISSION_REASON_CODES` в **обоих** локалях, плюс структурное
равенство неймспейса. Без него новый код провайдера всплыл бы в UI сырым
снейк-кейсом, а фолбэк, спасающий от пустой ячейки, ещё и спрятал бы пропуск.

### Финальная зачистка (интегратор)

- Читатель формы сведён к **одному**: 6 оставшихся вызовов в `public_rpc.py`
  переведены на `_common_service`, транзиторный форвардер в `service.py` удалён.
- Предупреждение про несуществующую миграцию `wsreq0002`
  (`shared/models/registration/registration.py`) переписано как история — оно
  читалось как незакрытая задача и отправляло искать ненаписанный файл.
- `SERIALIZED_KEYS` в `test_admission_subscription.py`: обоснование исправлено.
  Литерал больше не держит вместе две реализации (вторая удалена в Ф3), но
  остаётся allow-list'ом, не пускающим `guild_id` / `role_id` из `evidence`
  в публичную проекцию.

---

## 1. Проблема

Итоговое «допущен / не допущен» не вычисляется на бэкенде **нигде**. Сервер отдаёт
пять сырых полей (`status`, `balancer_status`, `checked_in`, `profiles_open`,
`subscription_outcome`), а решение собирает фронт — в пяти местах:

| Копия | Файл |
|---|---|
| `isAdmitted` | `frontend/src/components/status/RegistrationBadges.tsx:95` |
| вторая копия внутри `AdmissionStatusBadge` | там же, `:130-136` |
| `getAdmissionStatus` | `frontend/src/components/balancer/registrations/_components/registrationGrouping.ts:35` |
| `accessorFn` колонки Admission | `.../balancerRegistrationColumns.tsx:471` |
| `searchValue` той же колонки | там же, `:496` |

Пятая и четвёртая расходятся с остальными намеренно (игнорируют подписку).

Копий пять не из лени: каждому потребителю нужна **своя форма** одного вычисления
— `bool`, три состояния, ординал `0/1/2`, текст для поиска, `raise 400` с текстом
правила, и per-requirement tone+label для journey-шагов игрока
(`TournamentParticipantsPage.tsx:366-406`). Отсюда главное следствие для дизайна:

> **Единый слой не может возвращать `bool`.** Он возвращает структуру с разбором
> по требованиям, из которой каждый потребитель делает проекцию. Иначе
> journey-шаги останутся седьмой копией.

### 1.1 «Когда проверять» живёт в восьми местах

| # | Где | Для чего |
|---|---|---|
| 1 | `registration_form.subscription_stage` VARCHAR(16) | только подписка — единственное декларативное |
| 2 | `SubscriptionEnforcementStage` (`shared/core/enums.py:169`) | порядок стадий, в докстринге |
| 3 | `subscription_gate.enforces_at_registration()` | читатель №1 |
| 4 | **позиция / отсутствие вызова в 7 хендлерах** | вся матрица ниже |
| 5 | `force_refresh: bool` | «блокирующий момент» vs «чтение для UI» |
| 6 | `SubscriptionCollectionSource` | та же стадия, третий раз, для аудита |
| 7 | `deferred_providers` — только на регистрации (`subscription_gate.py:190`) | смягчение, зависящее от стадии |
| 8 | порядок JSX-шагов journey | конвейер, на фронте |

Матрица «где что реально проверяется»:

| Handler | Профиль | Подписка |
|---|---|---|
| `reg_pub_create` (`public_rpc.py:399`) | ✗ | ✓ `:410` |
| `regteam_create` (`:739`) | ✗ | ✓ `:749` |
| `reg_pub_update_me` (`:470`) | ✗ | ✗ |
| `reg_pub_check_in` (`:535`) | ✓ `:547` инлайн | ✓ `:558` |
| `reg_check_in` — админ (`registration_admin.py:889`) | ✗ | ✗ |
| `approve_registration` (`lifecycle.py:466`) | ✗ | ✗ |
| ручное создание (`lifecycle.py:283`) | ✗ | ✗ |

### 1.2 Причины `undetermined` теряются

Подписки уже умеют объясняться: `SubscriptionVerdict.evidence["reason"]`, 16 кодов,
наружу через `serialize_verdicts`. Профиль — нет: `resolve_profiles_open`
(`shared/services/profile_visibility.py:38-77`) сплющивает 7 значений
`RankCollectionStatus` **плюс** «тега вообще нет» в `bool | None`. Причину по
профилю надо не пробросить, а сначала перестать терять.

### 1.3 Форсированный допуск не представлен

Требования реализованы противоречиво: бэкенд — как **гейты на переходах**
(`raise 400`, после перехода не проверяет), фронт — как **инварианты**
(`isAdmitted` пересчитывает бессрочно). Следствие: админ вручную зачекинил игрока
с закрытым профилем → бейдж показывает «Не допущен» навсегда. Админский путь без
гейтов — это **механизм override**, сломанный только на выходе.

---

## 2. Принятые решения

| # | Решение |
|---|---|
| D1 | Требования — гейты на переходах, не инварианты состояния |
| D2 | `checked_in == True` ⟹ все требования израсходованы ⟹ допущен (при `ready`). Чек-ин — последний гейт любого требования (`registration` ⊃ `check_in`), поэтому публичный и админский чек-ин дают один результат. Различие уже лежит в `checked_in_by` и аудит-логе |
| D3 | `ready` (`approved ∧ balancer ready`) **не** гасится: это полнота данных (ранг назначен), у админа отдельные ручки |
| D4 | Заблокированные требования при `checked_in` показываются как `overridden` — видимы, но не блокируют |
| D5 | Формулировка `overridden` нейтральная: считаем по **текущим** сигналам, поэтому «админ форсил» и «подписка отвалилась после честного чек-ина» неразличимы. Текст: «требование не выполнено — допуск уже подтверждён» |
| D6 | Сортировка колонки Admission выравнивается с содержимым ячейки. Расхождение существовало только из-за отсутствия единой точки правды |
| D7 | Каждая причина несёт `actor` (`player` / `organizer` / `system`) — организатору нужно знать, кто чинит, а не только код |
| D8 | Стадия — явный параметр в каждой точке записи, не позиция вызова |
| D9 | Профилю стадия хардкодится `check_in` (текущее поведение). Колонка `open_profile_stage` — **не** заводится, пока не попросят |
| D10 | `resolve.py` зависит только от Protocol'ов → будущий переезд Discord на RPC в `discord-service` (кэш discord.py) не трогает admission |
| D11 | Кэш композита не вводится. Кэшируются уровни; форма не кэшируется вообще |
| D12 | `AdmissionConfig` собирается один раз за запрос и передаётся значением |
| D13 | Гейты кидают через существующую конвенцию `_fail(status, code, msg)` → `ApiHTTPException(detail=[ApiExc(msg, code)])` (`teams.py:106-113`), где `code` — код причины. Фронт уже умеет: `lib/registration-team-errors.ts` держит список кодов и маппит в i18n. Не изобретать второй механизм структурированных ошибок |
| D14 | Per-provider проекция `{state, tier_rank, tier_label, reason}` теперь дублируется трижды: `subscription_reads.serialize_verdicts`, `requirements/subscription.build_subscription_signal`, и литерал в его тесте. В Ф1 это неизбежно (`shared` не может импортировать сервис). Ф2 обязана свернуть: проекция уезжает в `shared`, `serialize_verdicts` становится ре-экспортом либо удаляется, когда `RegistrationSubscription` начнёт читать `SubscriptionSignal.providers` |

---

## 3. Целевая архитектура

```
shared/services/admission/
  types.py      # RequirementState, AdmissionStage, AdmissionDecision,
                # AdmissionReason, ReasonActor, RequirementVerdict, AdmissionEvaluation
  reasons.py    # REASON_ACTORS: dict[str, ReasonActor] + actor_for(code)
  config.py     # AdmissionConfig + AdmissionConfig.load(session, tournament_id)
  registry.py   # REQUIREMENTS: tuple[Requirement, ...]
  evaluate.py   # evaluate(config, signals, *, stage) -> AdmissionEvaluation   ← ЧИСТАЯ
  signals.py    # AdmissionSignals (сырые, батч)
  resolve.py    # resolve_admission(session, registrations, *, config, stage)  ← весь I/O
  gates.py      # assert_admitted(evaluation, *, stage) -> raise 400 из blockers
```

Ядро (`evaluate.py`) не знает про `AsyncSession`, HTTP и резолверы: батч-контракт
гарантирован тем, что функция синхронна и не может сделать I/O даже случайно.

### 3.1 Контракт

```python
class RequirementState(StrEnum):
    satisfied      = "satisfied"
    blocked        = "blocked"        # подтверждённый отказ — единственное, что блокирует
    undetermined   = "undetermined"   # fail-open: outage, не собрано, нет линка
    not_applicable = "not_applicable" # требование выключено конфигом

class AdmissionStage(StrEnum):
    registration = "registration"
    check_in     = "check_in"

class AdmissionDecision(StrEnum):
    admitted         = "admitted"
    pending_check_in = "pending_check_in"
    not_admitted     = "not_admitted"

class ReasonActor(StrEnum):
    player    = "player"
    organizer = "organizer"
    system    = "system"

@dataclass(frozen=True, slots=True)
class AdmissionReason:
    code: str                  # стабильный машинный код; i18n = admission.reason.{code}
    actor: ReasonActor         # из REASON_ACTORS; неизвестный код -> system
    subject: str | None        # "discord" | "twitch" | "Player#2100"

@dataclass(frozen=True, slots=True)
class RequirementVerdict:
    key: str                   # "open_profile" | "subscription"
    state: RequirementState
    stage: AdmissionStage      # с какого момента блокирует
    reasons: tuple[AdmissionReason, ...]
    detail: dict[str, Any]     # per-provider вердикты, scope — для чипов

@dataclass(frozen=True, slots=True)
class AdmissionEvaluation:
    decision: AdmissionDecision
    requirements: tuple[RequirementVerdict, ...]   # ВСЕ, включая not_applicable
    blockers: tuple[RequirementVerdict, ...]       # blocked И стадия ещё впереди
    overridden: tuple[RequirementVerdict, ...]     # blocked, но стадия израсходована
    checked_in: bool
    ready: bool
```

`requirements` отдаётся целиком, включая выключенные: journey-шаги строятся обходом
списка, а не двумя ad-hoc блоками с проверкой флага. `reasons` заменяет
`message_key`/`message_params` — текст `400` собирается из тех же причин, что рисует
UI, одна таксономия на оба выхода.

### 3.2 Ядро

```python
def evaluate(config, signals, *, stage) -> AdmissionEvaluation:
    verdicts = tuple(r.evaluate(config, signals) for r in REQUIREMENTS)
    blocked = tuple(v for v in verdicts if v.state is RequirementState.blocked)

    if signals.checked_in:
        # D2: чек-ин — последний гейт каждого требования. Пройден он гейтом или
        # выдан админом вручную — после него требования не пересматриваются.
        return AdmissionEvaluation(
            decision=admitted if signals.ready else not_admitted,
            requirements=verdicts, blockers=(), overridden=blocked,
            checked_in=True, ready=signals.ready,
        )
    ...
```

### 3.3 Реестр

```python
REQUIREMENTS = (
    Requirement(
        key="open_profile",
        enabled=lambda cfg: cfg.require_open_profile,
        stage=lambda cfg: AdmissionStage.check_in,   # D9: литерал, без колонки
        evaluate=eval_open_profile,
    ),
    Requirement(
        key="subscription",
        enabled=lambda cfg: cfg.require_subscription,
        stage=lambda cfg: cfg.subscription_stage,    # единственный читатель колонки
        evaluate=eval_subscription,
    ),
)
```

Третье требование = одна запись здесь + один резолвер сигнала. Сейчас это правка
5 фронтовых мест + 2 гейта + 2 сериализатора.

Существующая Kleene-композиция подписок (`shared/services/subscriptions/requirement.py`)
**не удаляется**: она становится резолвером сигнала для одного элемента реестра.

### 3.4 Конфиг

```python
@dataclass(frozen=True, slots=True)
class AdmissionConfig:
    require_open_profile: bool
    open_profile_scope: Literal["main", "all"]
    require_subscription: bool
    subscription_stage: AdmissionStage
    subscription_rule: SubscriptionRequirement | None   # из subscriptions.requirement

    @classmethod
    async def load(cls, session, *, tournament_id) -> AdmissionConfig: ...
```

Собирается один раз за запрос (D12). Гейт больше не читает форму сам — принимает
`AdmissionConfig`. Это убирает двойное чтение формы за запрос регистрации
(`public_rpc.py:409` в хендлере + `service.py:765` внутри юз-кейса; то же на
`regteam_create`).

`_common.get_registration_form` остаётся единственным читателем формы (5 вызывающих,
`_common.py` не импортирует `service.py` — цикла нет). `service.get_registration_form`
(`service.py:200-205`, тело побайтово идентично) удаляется, `service` делегирует
`_common_service`.

---

## 4. Таксономия причин

### 4.1 Профиль — новое

`resolve_profiles_open` расширяется до `dict[int, tuple[bool | None, tuple[AdmissionReason, ...]]]`.
Тело (строки 66-76) переписывается, а не оборачивается: причина теряется внутри цикла.

| Источник | code | state | actor |
|---|---|---|---|
| `battle_tag` пуст | `no_battle_tag` | undetermined | player |
| тега нет в `battle_tag_state` | `never_fetched` | undetermined | system |
| `pending` | `collection_pending` | undetermined | system |
| `error` / `rate_limited` | `collection_failed` | undetermined | system |
| `disabled` | `collection_disabled` | undetermined | organizer |
| `private` | `profile_private` | **blocked** | player |
| `not_found` | `profile_not_found` | **blocked** | player |

`subject` = сам battle tag: под `scope: all` из трёх смурфов закрыт один, и без
`subject` организатор не поймёт какой.

Новое хранение не требуется — всё выводится из `battle_tag_state.status`.

### 4.2 Подписки — коды есть, добавляется `actor`

| actor | codes |
|---|---|
| player | `no_linked_discord_account`, `no_linked_twitch_account`, `missing_scope`, `not_subscribed`, `not_a_member`, `no_mapped_role`, `no_code_redeemed` |
| organizer | `guild_not_configured`, `no_role_tiers_configured`, `role_mapping_drift`, `broadcaster_not_configured`, `twitch_client_not_configured`, `broadcaster_not_eligible` |
| system | `provider_unavailable`, `bot_not_configured`, `guild_not_accessible` |

`bot_not_configured` — `system`, не `organizer`: это отсутствующий `DISCORD_TOKEN`
в окружении, чинит деплой.

Хранение: `subscriptions.check_log.reason VARCHAR(64)` уже существует и заполняется
(`store.py:241`).

---

## 5. Фазы

### Ф0 — чистое ядро (нет вызывающих, ничего не ломается)

Создать `types.py`, `reasons.py`, `config.py` (только датакласс), `registry.py`,
`evaluate.py`, `signals.py`.

**Приёмка:**
- `evaluate()` синхронна, не импортирует `sqlalchemy` и `httpx`.
- Табличный тест `(config, signals, stage) → decision + blockers + overridden`.
- Именованный инвариант fail-open: **только** `blocked` блокирует, для каждого
  требования и каждой стадии. Цена регрессии — выпилить платящего подписчика из
  турнира во время чек-ина.
- Именованный инвариант D2: `checked_in=True ∧ blocked → decision == admitted`
  (при `ready`), для каждого требования и каждой стадии.
- `mode: any`: одно `blocked` рядом с `satisfied` = пропуск.
- Каждый код из обеих таксономий имеет `actor`; неизвестный код → `system`, не `KeyError`.

### Ф1 — resolve-слой (самая дорогая фаза)

- `resolve.py` поглощает `service.py:868 resolve_admission_signals`: та же батч-семантика
  (`force_refresh=False`, gating по флагам, один проход на список), но возвращает
  `dict[int, AdmissionEvaluation]`.
- **Расширить `resolve_profiles_open`** до `(verdict, reasons)`. Два вызывающих
  (`service.py:885`, `public_rpc.py:438/548`) уходят внутрь `resolve.py`.
- `AdmissionConfig.load` — форма через `_common_service`, правило через
  `resolver.load_requirement`.
- `force_refresh` и `SubscriptionCollectionSource` выводятся из `stage` **внутри**
  `resolve.py`, а не параметрами вызывающего.
- `deferred_providers` применяется, когда `stage == registration` — одна строка в
  ядре вместо присутствия/отсутствия вызова.

**Приёмка:**
- Список на 200 регистраций — то же число запросов, что сейчас (замерить до/после).
- Ни одного нового обращения к провайдеру на пути публичного списка.
- Тесты `test_registration_list_subscription.py` проходят без изменения ожиданий.
- Резолверы принимаются только как Protocol (D10).

### Ф2 — гейты

- `gates.assert_admitted(evaluation, *, stage)` — 400 из первого `blocker`,
  текст из `reasons`.
- `subscription_gate.py` теряет композицию, остаётся проекцией.
- **Удалить** инлайн-проверку профиля `public_rpc.py:547-553` — становится элементом реестра.
- Явная стадия в каждой точке записи (D8): `reg_pub_create`, `regteam_create` →
  `stage=registration`; оба чек-ина → `stage=check_in`.
- Русские литералы `detail=f"Для чек-ина нужна активная подписка: …"` заменяются
  на i18n-ключи.
- Админский `reg_check_in` остаётся **без** гейта, но с комментарием, что это
  заявленный override. **Не** добавлять параметр `override=True`: параметр,
  который только отключает вызов, — это тот же вызов, записанный дважды.

**Приёмка:**
- `test_check_in_subscription_gate.py`, `test_registration_subscription_gate.py`,
  `test_check_in_gate_integration.py` проходят.
- Новый тест: профиль блокирует чек-ин через реестр, не через инлайн-`if`.
- Новый тест: `stage=registration` при `subscription_stage=check_in` ничего не
  блокирует и **не** делает ни одного DB/провайдер-вызова.

### Ф3 — сериализация

- `AdmissionRead` в публичный (`schemas/registration.py`) и админский
  (`schemas/admin/balancer.py`) read: `decision`, `requirements[]` с
  `state`/`stage`/`reasons[]`, `blockers[]`, `overridden[]`.
- `profiles_open`, `subscription_outcome`, `subscription_verdicts` **остаются** —
  их читают отдельные колонки-чипы, это не копия правила.

**Приёмка:** публичный и админский read несут одинаковый `admission` для той же
регистрации (тест на равенство двух сериализаций).

### Ф4 — фронтенд

Удалить:
- `isAdmitted` (`RegistrationBadges.tsx:95`)
- вторую копию в `AdmissionStatusBadge` (`:130-136`)
- `getAdmissionStatus` (`registrationGrouping.ts:35`)
- `accessorFn` (`balancerRegistrationColumns.tsx:471`) → `ADMISSION_ORDER[reg.admission.decision]` (D6)
- `searchValue` (`:496`)
- prop-плетение `requireOpenProfile`/`requireSubscription` через
  `RegistrationsTable → columns → badge` (3 слоя, 2 флага)

Добавить:
- Колонка `Reason` + агрегат над списком:
  `12 ждут сбора ранга · 3 без Discord · ⚠ role mapping сломан`.
- `overridden` непусто + `checked_in` → бейдж `Допущен` с маркером и причиной (D4/D5).
- Journey-шаги — `map` по `admission.requirements` с actor-зависимым CTA
  («привяжи Discord» — кнопка; «ранг ещё собирается» — текст).

Оставить: `frontend/src/lib/subscription-requirement.ts` — превьюит **несохранённое**
правило в админской форме, сервер про него не знает.

**Приёмка:**
- Ни одного вычисления допуска на фронте: `grep -r "balancer_status === \"ready\""` пуст.
- Сортировка колонки Admission согласована с её ячейкой.
- Behavior-тест: форсированный чек-ин при заблокированном требовании рисует
  `Допущен` + маркер.

### Ф5 — тесты и i18n

- Пять per-copy наборов (`RegistrationBadges.behavior.test.tsx`,
  `registrationGrouping.test.ts`, части `test_check_in_subscription_gate.py`) →
  одна таблица на ядро + по одному smoke на проекцию.
- Интеграционные (`test_check_in_gate_integration.py`) остаются: проверяют I/O.
- i18n `admission.reason.*` в `en.json` / `ru.json` + тест на полноту ключей
  относительно `REASON_ACTORS` — иначе новый код провайдера появится в UI как
  сырой снейк-кейс.

---

## 6. Non-goals

| Что | Почему не сейчас |
|---|---|
| Колонка `open_profile_stage` | D9: спекуляция, пока организатор не попросил |
| Материализация `admission` в БД | производная от четырёх живых сигналов; кэш разойдётся при смене правила воркспейса |
| Кэш формы | меняется организатором в реальном времени; несвежесть = ложный отказ либо ложное разрешение. `service.py:915-924` уже предупреждает про `cache.disabling` как процесс-глобальную ловушку |
| Полный `TournamentConfig` (ростер + грид + окна) | у каждого уже свой аккессор и свои потребители; без потребителя, которому нужны все поля сразу, это шесть чтений там, где нужны два |
| Переезд Discord на RPC в `discord-service` | отдельная задача; D10 гарантирует, что admission не придётся трогать |
| Пресеты `subscriptions.requirement` | таблица preset-ready (`name`, UNIQUE `(workspace_id, name)`), но читатель берёт только `is_default`. Мёртвая ёмкость до nullable FK на форме |

---

## 7. Риски

| Риск | Митигация |
|---|---|
| Ослабление батч-контракта | per-registration вызов упирается в per-guild rate-limit Discord и убивает страницу на 200 участников. Гарантия структурная: `evaluate()` синхронна |
| Регрессия fail-open | именованный тест на каждое требование × стадию. Цена — недопуск платящего подписчика во время чек-ина |
| D6 переставит сохранённые представления | видимый эффект, решение принято осознанно: колонка, чья сортировка противоречит своему содержимому, — баг с оправданием |
| Ф1 переписывает тело `resolve_profiles_open` | единственная фаза с реальным переписыванием, а не проекцией. Изолирована: два вызывающих, оба уходят внутрь `resolve.py` |
| `overridden` считается по текущим сигналам | D5: формулировка нейтральная. Различать «форс» и «отвалилось после» = сравнивать `checked_in_at` с временем вердикта, которого вердикты не хранят |

---

## 8. Смежная находка (вне плана, не блокирует)

`shared/models/registration/registration.py:65-68` предупреждает про миграцию
`wsreq0002`, которая дропнет `subscription_requirement_json`. Миграции нет и не
будет: подписочная схема свёрнута в `initial_v6.py`, где `registration_form` идёт
`require_subscription` → `subscription_stage` напрямую
(`initial_v6.py:1354-1355`, `docs/schema.sql:947-948`). Колонки в схеме нет.
Комментарий описывает опасность, которой не существует, и читается как незакрытая
задача. Удалить при правках Ф1.

Не путать с `schemas/registration.py:95` — там `subscription_requirement_json`
легитимен: это разрешённая проекция workspace-правила в read-схеме для диалога.
