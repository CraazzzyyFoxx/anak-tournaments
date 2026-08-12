# Catalog Aliases — динамический справочник имён каталога вместо хардкода в парсере

**Status:** accepted (2026-08-05)
**Plan:** `docs/superpowers/plans/2026-08-05-catalog-aliases.md`
**Затрагивает:** `parser-service` (обработка логов, синк OverFast), `app-service` (админ-CRUD каталога), `gateway`, `frontend/src/app/admin`, `shared` (модели, репозитории, enum), одна миграция от головы `mapcomp0001`.

---

## 1. Understanding Summary

- **Что.** Три хардкод-словаря в `parser-service/src/core/enums.py` (`game_mode_dict` — 7 записей, `map_name_dict` — 43, `hero_translation` — 53) заменяются справочником алиасов в БД: колонка `aliases` (JSONB `list[str]`) на `overwatch.hero` / `overwatch.map` / `overwatch.gamemode`. Алиасы героев наполняет синк OverFast по всем 13 локалям Blizzard; алиасы карт и режимов — ручные, через существующие админ-страницы. Нераспознанные имена из логов копятся в `overwatch.catalog_alias_miss` и показываются в админке очередью «добавьте алиас» с привязкой в один клик.
- **Зачем.** Новый герой, новая карта, сезонный вариант карты или логи с клиента на незнакомой локали требуют правки Python-файла и передеплоя `parser-service`. После изменения — либо синк OverFast (`rpc.parser.metadata.sync_heroes`, уже есть), либо одна запись в админке.
- **Для кого.** Суперадмин, разгребающий упавшие и недообработанные match-логи.
- **Ключевые ограничения.** OverFast локализует только героев; у `/maps` и `/gamemodes` параметра `locale` нет вовсе. Часть записей `map_name_dict` — не перевод, а нормализация (`King's Row` → `King’s Row`) и сезонные варианты (`Hollywood (Halloween)` → `Hollywood`), их локаль не покрыла бы никогда.
- **Не-цели.** Нормализация имён (casefold / NFKC / апострофы). Провенанс алиасов отдельными строками. Локализация карт из сторонних источников. Перенос `log_stats_index_map` (это индексы колонок лога, а не перевод).

## 2. Current State (проверено)

### 2.1 Точки использования словарей

Ровно две, обе в `parser-service/src/services/match_logs/flows.py`:

| Место | Код | Поведение при промахе |
| --- | --- | --- |
| `MatchLogProcessor.get_map` (`:246-258`) | `game_mode_dict.get(raw, raw)`, `map_name_dict.get(raw, raw)` → `map_flows.get_by_name_and_gamemode` | **Жёсткий 404** `not_found` → лог падает, `LogProcessingRecord` → `failed` |
| `MatchLogProcessor._preload_data` (`:260-265`) + `get_hero` (`:267-279`) | алиасы доливаются в `self.heroes_map`, затем `hero_translation.get(name, name)` | **Мягкий**: все три вызова ловят `ApiHTTPException` |

Мягкость промаха по герою — существующая слепая зона, а не новая проблема:

- `process_kills` (`:434`) — килл пропускается;
- `_format_match_event_generic` (`:488`, `:500`) — `hero_id = None`;
- `_get_player_stat_base_df` (`:596`) — строка статистики пропускается.

Лог при этом успешно доходит до `set_done`, теряя данные и оставляя один `logger.warning`. Никакого агрегированного сигнала нет.

`get_hero` **синхронный** и вызывается из синхронного `_format_match_event_generic` — `await` внутри него невозможен.

### 2.2 Что уже есть

- **Синк каталога из OverFast:** `rpc.parser.metadata.sync_{heroes,maps,gamemodes}` (`parser-service/src/rpc/misc.py:33`) → `services/{hero,map,gamemode}/flows.initial_create`. Суперадмин, без передеплоя.
- **Админ-CRUD каталога** живёт в `app-service`: `rpc.app.{heroes,maps,gamemodes}.admin_{list,create,update,delete}`, регистрируется генериком `_register_entity` в `src/rpc/metadata_admin.py:35`. Фронт — `/admin/{heroes,maps,gamemodes}`.
- **Таблица `Settings`** с типизированными схемами (`shared/schemas/settings.py`) и кешированным ридером (`shared/services/settings_provider.py`).

### 2.3 Возможности OverFast (проверено против openapi.json живого инстанса `overfast.craazzzyyfoxx.me`, 2026-08-05)

| Эндпоинт | Параметры | Локализация |
| --- | --- | --- |
| `/heroes` | `role`, `locale`, `gamemode` | **есть** — 13 локалей: `de-de en-gb en-us es-es es-mx fr-fr it-it ja-jp ko-kr pl-pl pt-br ru-ru zh-tw` |
| `/maps` | только `gamemode` | нет |
| `/gamemodes` | — | нет |

`GET /heroes?locale=ru-ru` возвращает `{key: "ana", name: "Ана", role: "support", …}` — `key` стабилен и равен `hero.slug` в БД, `role` приходит в payload при любом фильтре.

Отсюда — асимметрия дизайна: герои автоматизируются полностью, карты и режимы принципиально ручные.

### 2.4 Схема каталога

```
overwatch.hero      (slug UK, name UK, image_path, type, color)
overwatch.gamemode  (slug UK, name UK, image_path, description)
overwatch.map       (gamemode_id FK, name UK, image_path, in_competitive)   -- slug отсутствует
```

Alembic head — `mapcomp0001`. В `shared/models` нет ни одного `ARRAY(...)`; массивы и структуры хранятся в `JSONB` (`match.py`, `stat_baseline.py`, `overwatch_rank.py`) — конвенция соблюдена.

## 3. Assumptions

| # | Предположение | Статус |
| --- | --- | --- |
| A1 | Data-миграция переносит все 103 записи из трёх словарей; имя, которого нет в каталоге, пропускается с предупреждением | подтверждено |
| A2 | Синк героев переписывается на один запрос на локаль (13) вместо одного на роль; `?role=` избыточен | подтверждено |
| A3 | Семантика лукапа карты не меняется: режим по имени-или-алиасу, затем карта по имени-или-алиасу в этом режиме; промах — 404 | подтверждено |
| A4 | Промах пишется в отдельной сессии с немедленным коммитом; сбой записи глотается и не подменяет исходную ошибку | подтверждено |
| A5 | Точное совпадение алиаса, без регистронезависимости | подтверждено |
| A6 | GIN-индекс по `aliases` не нужен: ~45 карт, ~10 режимов, запрос раз на лог | подтверждено |

## 4. Design

### 4.1 Данные

```python
# shared/models/catalog/{hero,map,gamemode}.py — одинаково в трёх файлах
# JSONB не отслеживает in-place мутации: aliases.append(x) НЕ попадёт в UPDATE.
# Писать только переприсваиванием: obj.aliases = [*obj.aliases, x]
aliases: Mapped[list[str]] = mapped_column(
    JSONB(), nullable=False, server_default=text("'[]'::jsonb"), default=list
)
```

```python
# shared/core/enums.py
class CatalogEntityType(StrEnum):
    hero = "hero"
    map = "map"
    gamemode = "gamemode"
```

```python
# shared/models/catalog/alias_miss.py
class CatalogAliasMiss(db.TimeStampIntegerMixin):
    __tablename__ = "catalog_alias_miss"
    __table_args__ = (
        UniqueConstraint("entity_type", "raw_name", name="uq_catalog_alias_miss_entity_raw"),
        {"schema": "overwatch"},
    )
    entity_type: Mapped[enums.CatalogEntityType] = mapped_column(Enum(enums.CatalogEntityType), nullable=False)
    raw_name: Mapped[str] = mapped_column(String(128), nullable=False)
    occurrences: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="1")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=db.func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=db.func.now())
    last_log_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("log_processing.record.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Почему таблица, а не ключ `Settings`: путь записи конкурентный (`_MATCH_LOG_CHANNEL` с `prefetch_count=2` × реплики воркера). Read-modify-write JSON-блоба теряет записи; `INSERT … ON CONFLICT DO UPDATE` по `uq_catalog_alias_miss_entity_raw` — атомарен и даёт счётчик частоты бесплатно. Почему не «читать `LogProcessingRecord.error`»: промахи по героям туда вообще не попадают — они не поднимают исключение наружу (§2.1).

`resolved_at` вместо удаления строки: повторное появление имени переоткрывает промах (`resolved_at = NULL`) и инкрементит счётчик, то есть «скрыл, а оно снова лезет» видно, а не теряется.

### 4.2 Разрешение имени

```python
# shared/repository/catalog.py
class MapRepository(BaseRepository[models.Map]):
    async def get_by_name_or_alias_and_gamemode(
        self, session, *, name: str, gamemode: str, with_gamemode: bool = False
    ) -> models.Map | None:
        query = (
            sa.select(models.Map)
            .join(models.Gamemode)
            .where(
                sa.or_(models.Map.name == name, models.Map.aliases.contains([name])),
                sa.or_(models.Gamemode.name == gamemode, models.Gamemode.aliases.contains([gamemode])),
            )
        )
```

`JSONB.contains([name])` компилируется в `aliases @> '["Илиос"]'::jsonb`. Один запрос вместо двух — режим и карта разрешаются в одном `JOIN`, семантика двух предикатов из `get_by_name_and_gamemode` сохранена целиком (A3).

Герои остаются в памяти: `_preload_data` доливает `hero.aliases` в `self.heroes_map` — ровно как сейчас делает `hero_translation`, только источник другой.

### 4.3 Запись промахов

`parser-service/src/services/catalog_aliases.py` — один батчевый апсерт:

```python
async def record_misses(
    entity_type: enums.CatalogEntityType, raw_names: Iterable[str], *, log_record_id: int | None = None
) -> None:
    """Апсертит промахи в собственной транзакции — иначе rollback падающей
    обработки лога съест запись. Best-effort: своя ошибка только логируется."""
```

Две точки вызова, потому что контексты разные:

| Сущность | Контекст | Механика |
| --- | --- | --- |
| `map`, `gamemode` | async, жёсткий 404 | `await record_misses(...)` инлайн, затем `raise` — как сейчас |
| `hero` | **sync** `get_hero`, мягкий промах | имя кладётся в `self.hero_misses: set[str]`; один батч сбрасывается в `start()` после `create_stats` (`flows.py:1027`) |

Батч по героям решает сразу три вещи: `await` в синхронном `get_hero` не нужен, один upsert на лог вместо одного на килл-ивент, и слепая зона §2.1 становится видимой в админке.

Сброс стоит до финального `commit()` (`:1034`), в своей сессии — поэтому запись доживает и до успеха, и до отката.

### 4.4 Синк героев

```python
# parser-service/src/services/hero/flows.py
CANONICAL_LOCALE = "en-us"
ALIAS_LOCALES = ("de-de", "en-gb", "es-es", "es-mx", "fr-fr", "it-it",
                 "ja-jp", "ko-kr", "pl-pl", "pt-br", "ru-ru", "zh-tw")

async def fetch_heroes(locale: str) -> list[schemas.OverfastHero]:   # было fetch_heroes(role)
    ... f"{base}/heroes?locale={locale}"
```

`initial_create`: канон (`name`, `type`, `image_path`) из `en-us`, затем 12 локалей → `dict[slug, set[str]]`, затем `aliases` каждого героя = объединение существующих и локализованных, минус каноническое имя. 13 запросов вместо 5; `?role=` уходит — роль и так в payload (§2.3), и заодно исчезает связка с `enums.HeroClass.__members__`.

Создание новых героев не меняется; для существующих строк синк теперь обновляет только `aliases` (`name`/`image_path` по-прежнему не трогает — минимальный диф).

Карты и режимы синк не трогает: у OverFast нет локали, их алиасы ручные.

### 4.5 Админ-поверхность

**app-service:**

- `aliases: list[str] | None = None` в `{Hero,Map,Gamemode}{Create,Update}`; `aliases: list[str] = []` в `{Hero,Map,Gamemode}Read`.
- `services/admin/{hero,map,gamemode}.py`: нормализация значения — `strip`, отброс пустых, дедуп с сохранением порядка.
- Новый `src/rpc/catalog_aliases.py`, суперадмин:

| Subject | Смысл |
| --- | --- |
| `rpc.app.catalog_aliases.misses_list` | открытые промахи (по умолчанию `resolved_at IS NULL`), сортировка по `occurrences` |
| `rpc.app.catalog_aliases.attach` | `{entity_type, entity_id, alias}` → дописать алиас сущности **и** закрыть промах, одна транзакция |
| `rpc.app.catalog_aliases.dismiss` | `resolved_at = now()` |

`attach` делает объединение на сервере, потому что клиентский `PATCH aliases=[...existing, raw]` — гонка read-modify-write между двумя админами.

**gateway:** четыре `edge.RouteSpec` дописываются в существующую таблицу `app.MetadataAdminRoutes` (`gateway/internal/app/metadata_admin_routes.go`). Новой таблицы нет, поэтому `apidocs/groups.go` и `edge/apiv1_guard_test.go` менять не нужно — группа `Admin: Game Metadata` уже указывает на `app.MetadataAdminRoutes`.

**openapi:** записи в `app-service/src/openapi_docs.py` + `openapi_schemas.py`, затем регенерация `gateway/internal/openapi/schemas.json` через `backend/scripts/export_openapi_schemas.sh`. Отсутствующая запись деградирует до generic `object` молча — проверяется, не предполагается.

**frontend:** поле алиасов в трёх существующих диалогах `/admin/{heroes,maps,gamemodes}` (одна textarea, по строке на алиас) + новая страница `/admin/aliases` с очередью промахов, выбором целевой сущности и кнопками «Привязать» / «Скрыть». Админка не переведена — строки хардкодятся по-английски, как на всех остальных админ-экранах.

### 4.6 Миграция

`catalias0001_add_catalog_aliases.py`, `down_revision = "mapcomp0001"`:

1. `aliases` JSONB `NOT NULL DEFAULT '[]'::jsonb` на `overwatch.{hero,map,gamemode}`;
2. `overwatch.catalog_alias_miss` + уникальный индекс;
3. data-миграция: три словаря вписаны в файл миграции **литералами** (миграция не импортирует прикладной код, иначе она перестанет применяться после первого же рефакторинга `enums.py`). Для каждой пары `alias → canonical`: найти строку по `name = canonical`, дописать алиас в `aliases`; ненайденное каноническое имя — `print` с предупреждением и пропуск;
4. `downgrade`: `drop_table` + три `drop_column`.

### 4.7 Удаляется

`game_mode_dict`, `map_name_dict`, `hero_translation` из `parser-service/src/core/enums.py`. Других импортёров нет (проверено `grep` по `backend/`).

## 5. Осознанные потолки

Все идут `ponytail:`-комментариями в коде.

| Потолок | Когда снимать |
| --- | --- |
| Синк только доливает алиасы, никогда не удаляет — нет провенанса `overfast` vs `manual` | когда OverFast переименует героя и устаревший алиас начнёт конфликтовать; тогда `list[{alias, source}]` или две колонки |
| Точное совпадение, без casefold/NFKC | когда очередь промахов заполнится вариантами регистра |
| GIN-индекса по `aliases` нет | когда карт станет сотни |
| `aliases` попадает в публичный `/api/v1/heroes` (~600 лишних строк на кешированном сутки эндпоинте) | когда payload станет заметен; тогда отдельные `*AdminRead` схемы и 4-й параметр `_register_entity` |

## 6. Риски

| Риск | Митигация |
| --- | --- |
| Data-миграция промахнётся по имени, которого нет в каталоге, и алиас потеряется молча | миграция печатает каждое пропущенное каноническое имя; проверка после применения — количество непустых `aliases` |
| Забыть, что JSONB не отслеживает in-place мутации, и потерять запись алиаса | комментарий у колонки; в коде только переприсваивание |
| Запись промаха в отдельной сессии утечёт коннекшн при исключении | `async with async_session_maker()`; весь блок в `try/except` с логом |
| Стаl `schemas.json` — гейт CI на него отсутствует | регенерация и проверка `jq` в шаге плана |

## 7. Decision Log

| Решение | Альтернативы | Почему так |
| --- | --- | --- |
| `aliases` JSONB-массив на существующих таблицах каталога | (а) таблица `catalog_alias` с провенансом; (б) ключ `Settings` `parser.log_name_aliases` | Одна миграция и три поля вместо нового домена с репозиторием, RPC и отдельной страницей. Ручное редактирование получает готовые админ-страницы `/admin/{heroes,maps,gamemodes}` — новый UI нужен только для очереди промахов. Провенанс — единственное, что теряется, и он не нужен, пока OverFast не переименовывает героев |
| Все 13 локалей Blizzard | только `ru-ru` + `en-us` | 11 лишних HTTP-запросов раз в синк против «лог игрока с корейским клиентом молча теряет статистику». Стоимость нулевая |
| Отдельная таблица `catalog_alias_miss` | (а) ключ `Settings`; (б) читать `LogProcessingRecord.error` | Путь записи конкурентный — RMW JSON-блоба теряет записи. `error` не содержит промахов по героям вообще: они не выходят наружу как исключение |
| Батч промахов по героям в `start()` | upsert на каждом промахе | `get_hero` синхронный (`await` невозможен) и вызывается на каждый килл-ивент |
| Режим и карта разрешаются одним `JOIN`-запросом | сначала режим, потом карта | Один round-trip, и семантика двух предикатов сохраняется без дополнительного кода |
| `attach` объединяет алиас на сервере | `PATCH aliases` из браузера | Убирает гонку read-modify-write и связывает «дописать алиас» с «закрыть промах» одной транзакцией |
| Точное совпадение, без нормализации | casefold + NFKC + унификация апострофа на записи и чтении | Нормализация требует функционального индекса или денормализованной колонки; текущие апострофные расхождения покрываются двумя явными алиасами, а пробелы ловит очередь промахов |
| Словари вписаны в миграцию литералами | импорт из `enums.py` | Миграция обязана быть воспроизводимой после удаления словарей из кода |

## 8. Exit Criteria

Understanding Lock подтверждён; подход A принят целиком (включая страницу `/admin/aliases`); A1–A6 подтверждены; потолки и риски зафиксированы; Decision Log полон.
