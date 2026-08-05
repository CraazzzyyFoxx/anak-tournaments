# Catalog Aliases Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Заменить три хардкод-словаря переводов в `parser-service` на справочник алиасов в БД, наполняемый синком OverFast (герои, 13 локалей) и вручную через админку (карты, режимы), с очередью нераспознанных имён.

**Architecture:** Колонка `aliases` (JSONB `list[str]`) на `overwatch.{hero,map,gamemode}` + таблица `overwatch.catalog_alias_miss`. Разрешение карты/режима — одним `JOIN`-запросом с `aliases @> '[name]'`; героев — по-прежнему в памяти из `hero.aliases`. Промахи апсертятся в отдельной транзакции: карта/режим инлайн перед `raise`, герои — батчем в конце `start()`. Полный дизайн и Decision Log: `docs/superpowers/specs/2026-08-05-catalog-aliases-design.md`.

**Tech Stack:** Python 3.13 / SQLAlchemy 2 async / Alembic / FastStream+RabbitMQ RPC / Go gateway (`edge.RouteSpec`) / Next.js 15 App Router + TanStack Query + shadcn.

---

## Соглашения этого плана

- Все команды — из корня репозитория, если не сказано иначе.
- Backend-тесты: `cd backend && rtk uv run python -m pytest <путь> -q`. Тесты — stdlib `unittest.TestCase` с bootstrap `sys.path` и env-затычками в шапке файла (образец: `backend/parser-service/tests/test_match_log_parser.py:1-26`) — копировать шапку из соседнего файла, не изобретать.
- Frontend: `cd frontend && rtk npx vitest run <путь>`, типы — `rtk npx tsc --noEmit`.
- Gateway: `rtk go test ./gateway/...`.
- Линт backend: `cd backend && rtk uv run ruff check <путь> && rtk uv run ruff format <путь>`.
- Админка **не переведена** — новые строки хардкодятся по-английски, как на всех остальных админ-экранах.
- Каждая задача заканчивается коммитом. Порядок задач важен: **Task 2 обязана быть выполнена до Task 6**, потому что миграция копирует словари из ещё не удалённого `enums.py`.

---

## Task 1: Модель — колонка `aliases`, enum, таблица промахов

**Files:**
- Modify: `backend/shared/core/enums.py`
- Modify: `backend/shared/models/catalog/hero.py`
- Modify: `backend/shared/models/catalog/map.py`
- Modify: `backend/shared/models/catalog/gamemode.py`
- Create: `backend/shared/models/catalog/alias_miss.py`
- Modify: `backend/shared/models/catalog/__init__.py`
- Test: `backend/parser-service/tests/test_catalog_aliases.py`

**Step 1: Написать падающий тест**

Шапку с `sys.path` / env скопировать из `backend/parser-service/tests/test_match_log_parser.py:1-26`.

```python
models = importlib.import_module("shared.models")
shared_enums = importlib.import_module("shared.core.enums")


class CatalogAliasSchemaTests(TestCase):
    def test_catalog_entities_carry_an_aliases_column(self) -> None:
        for model in (models.Hero, models.Map, models.Gamemode):
            column = model.__table__.c["aliases"]
            self.assertFalse(column.nullable, f"{model.__name__}.aliases must be NOT NULL")
            self.assertEqual("JSONB", column.type.__class__.__name__)

    def test_alias_miss_is_unique_per_entity_and_raw_name(self) -> None:
        table = models.CatalogAliasMiss.__table__
        self.assertEqual("overwatch", table.schema)
        constraint = next(
            c for c in table.constraints if getattr(c, "name", None) == "uq_catalog_alias_miss_entity_raw"
        )
        self.assertEqual(["entity_type", "raw_name"], [c.name for c in constraint.columns])

    def test_entity_type_enum_covers_the_three_catalog_entities(self) -> None:
        self.assertEqual(
            {"hero", "map", "gamemode"},
            {member.value for member in shared_enums.CatalogEntityType},
        )
```

**Step 2: Запустить, убедиться что падает**

Run: `cd backend && rtk uv run python -m pytest parser-service/tests/test_catalog_aliases.py -q`
Expected: FAIL — `KeyError: 'aliases'` / `AttributeError: CatalogAliasMiss`.

**Step 3: Реализовать**

В `shared/core/enums.py` — рядом с остальными `StrEnum`, добавить в `__all__`:

```python
class CatalogEntityType(StrEnum):
    """Сущность каталога, к которой относится алиас или промах разрешения."""

    hero = "hero"
    map = "map"
    gamemode = "gamemode"
```

В каждый из трёх файлов `shared/models/catalog/{hero,map,gamemode}.py` — импорт `from sqlalchemy import text` (в `map.py` уже есть) и `from sqlalchemy.dialects.postgresql import JSONB`, затем поле. Комментарий обязателен — это грабли, на которые наступают:

```python
    # Имена этой сущности в логах, отличные от `name`: локализации из OverFast
    # (герои) и ручные записи (карты, режимы, сезонные варианты, апострофы).
    # ВНИМАНИЕ: JSONB не отслеживает in-place мутации — `aliases.append(x)` НЕ
    # попадёт в UPDATE. Писать только переприсваиванием: `obj.aliases = [...]`.
    aliases: Mapped[list[str]] = mapped_column(
        JSONB(), nullable=False, server_default=text("'[]'::jsonb"), default=list
    )
```

`backend/shared/models/catalog/alias_miss.py` — код из дизайна §4.1. FK → `log_processing.record.id` (таблица `record` в схеме `log_processing`, см. `shared/models/ingestion/log_processing.py:34-42`), `ondelete="SET NULL"`, `__all__ = ("CatalogAliasMiss",)`.

В `shared/models/catalog/__init__.py` добавить `from .alias_miss import *` **после** остальных (импортирует `log_processing`, порядок важен только для читаемости).

**Step 4: Запустить тест**

Run: `cd backend && rtk uv run python -m pytest parser-service/tests/test_catalog_aliases.py -q`
Expected: PASS (3 passed)

**Step 5: Коммит**

```bash
rtk git add backend/shared/core/enums.py backend/shared/models/catalog backend/parser-service/tests/test_catalog_aliases.py
rtk git commit -m "feat(catalog): add aliases column and alias-miss model"
```

---

## Task 2: Миграция `catalias0001` + перенос 103 записей

**Files:**
- Create: `backend/migrations/versions/catalias0001_add_catalog_aliases.py`

**Step 1: Снять словари из кода в литералы миграции**

Словари ещё живы в `backend/parser-service/src/core/enums.py` (`game_mode_dict:25-33`, `map_name_dict:36-80`, `hero_translation:83-137`). Выгрузить их в файл миграции литералами, без импорта прикладного кода — миграция обязана применяться и после удаления словарей (Task 6):

```bash
cd backend && rtk uv run python - <<'PY' > /tmp/alias_seed.py
import ast, pathlib
src = pathlib.Path("parser-service/src/core/enums.py").read_text(encoding="utf-8")
wanted = {"game_mode_dict": "GAMEMODE_ALIASES", "map_name_dict": "MAP_ALIASES", "hero_translation": "HERO_ALIASES"}
for node in ast.parse(src).body:
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        name = wanted.get(node.targets[0].id)
        if name:
            print(f"{name} = {ast.literal_eval(node.value)!r}\n")
PY
```

Проверить количество: `grep -c "':" /tmp/alias_seed.py` → должно быть 103 (7 + 43 + 53).

**Step 2: Написать миграцию**

`revision = "catalias0001"`, `down_revision = "mapcomp0001"` (текущая голова — проверить `cd backend && rtk uv run alembic heads`).

```python
"""Catalog name aliases + unresolved-name queue.

Заменяет три хардкод-словаря переводов в parser-service
(``src/core/enums.py``: game_mode_dict / map_name_dict / hero_translation) на
данные: ``aliases`` на сущностях каталога и очередь нераспознанных имён.
Словари вписаны литералами — миграция не импортирует прикладной код, иначе она
перестанет применяться после их удаления.
"""

def upgrade() -> None:
    for table in ("hero", "map", "gamemode"):
        op.add_column(
            table,
            sa.Column("aliases", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            schema="overwatch",
        )

    op.create_table(
        "catalog_alias_miss",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entity_type", sa.Enum("hero", "map", "gamemode", name="catalogentitytype"), nullable=False),
        sa.Column("raw_name", sa.String(length=128), nullable=False),
        sa.Column("occurrences", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_log_record_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["last_log_record_id"], ["log_processing.record.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("entity_type", "raw_name", name="uq_catalog_alias_miss_entity_raw"),
        schema="overwatch",
    )

    _seed("hero", HERO_ALIASES)
    _seed("map", MAP_ALIASES)
    _seed("gamemode", GAMEMODE_ALIASES)
```

`_seed` группирует алиасы по каноническому имени и одним `UPDATE … WHERE name = :canonical` дописывает их, печатая пропуски:

```python
def _seed(table: str, mapping: dict[str, str]) -> None:
    conn = op.get_bind()
    by_canonical: dict[str, list[str]] = {}
    for alias, canonical in mapping.items():
        if alias != canonical:
            by_canonical.setdefault(canonical, []).append(alias)

    for canonical, aliases in by_canonical.items():
        result = conn.execute(
            sa.text(
                f"UPDATE overwatch.{table} SET aliases = :aliases::jsonb "  # noqa: S608 - table из литерала выше
                "WHERE name = :canonical RETURNING id"
            ),
            {"aliases": json.dumps(sorted(set(aliases))), "canonical": canonical},
        ).first()
        if result is None:
            print(f"catalias0001: overwatch.{table} has no row named {canonical!r}; {len(aliases)} alias(es) skipped")
```

Важно: `if alias != canonical` — в `map_name_dict` есть `"King's Row": "King’s Row"` (разные апострофы, переносится) и в `hero_translation` `"Freya": "Freja"`; тождественных пар нет, но проверка защищает от их появления и от вставки алиаса, равного `name` (тогда `aliases @> [name]` дублировал бы предикат).

`downgrade`: `op.drop_table("catalog_alias_miss", schema="overwatch")`, три `op.drop_column(..., schema="overwatch")`, `sa.Enum(name="catalogentitytype").drop(op.get_bind())`.

**Step 3: Применить и проверить**

```bash
rtk make dev-up
rtk make migrate
$(COMPOSE) exec -T app-svc python -c "
import asyncio, sqlalchemy as sa
from src.core.db import async_session_maker
async def main():
    async with async_session_maker() as s:
        for t in ('hero','map','gamemode'):
            n = await s.scalar(sa.text(f\"select count(*) from overwatch.{t} where jsonb_array_length(aliases) > 0\"))
            print(t, n)
asyncio.run(main())"
```
Expected (посчитано по словарям — число различных канонических целей, а не 103): `hero` = 50, `map` = 32, `gamemode` = 7. Ноль по любой сущности = миграция не сработала. Меньше — значит часть канонических имён отсутствует в каталоге; каждое `print`-предупреждение разобрать: либо карта/герой, которых нет в БД (тогда синк OverFast их добавит, а алиас дописывается через `/admin/aliases`), либо опечатка в словаре.

**Step 4: Откат и повторное применение**

```bash
$(COMPOSE) exec app-svc alembic downgrade -1 && rtk make migrate
```
Expected: обе операции без ошибок — `downgrade` обязан быть рабочим.

**Step 5: Коммит**

```bash
rtk git add backend/migrations/versions/catalias0001_add_catalog_aliases.py
rtk git commit -m "feat(db): catalog aliases column, alias-miss queue, seed from parser dicts"
```

---

## Task 3: Разрешение имени в репозитории

**Files:**
- Modify: `backend/shared/repository/catalog.py:168-182`
- Test: `backend/parser-service/tests/test_catalog_aliases.py`

**Step 1: Написать падающий тест**

Компилируем запрос без БД и проверяем, что оба предиката ушли в `WHERE`:

```python
    def test_map_lookup_matches_name_or_alias_for_both_map_and_gamemode(self) -> None:
        from shared.repository import MapRepository

        query = MapRepository().build_name_or_alias_query(name="Илиос", gamemode="Контроль")
        sql = str(query.compile(compile_kwargs={"literal_binds": True}))
        self.assertIn("overwatch.map.name = 'Илиос'", sql)
        self.assertIn("overwatch.gamemode.name = 'Контроль'", sql)
        self.assertEqual(2, sql.count("@>"), "both map.aliases and gamemode.aliases must be matched")
```

**Step 2: Запустить, убедиться что падает**

Run: `cd backend && rtk uv run python -m pytest parser-service/tests/test_catalog_aliases.py -q`
Expected: FAIL — `AttributeError: build_name_or_alias_query`.

**Step 3: Реализовать**

В `MapRepository` (`shared/repository/catalog.py`) — построитель запроса выделен отдельным синхронным методом ровно для того, чтобы его можно было проверить без БД:

```python
    @staticmethod
    def build_name_or_alias_query(*, name: str, gamemode: str) -> sa.Select:
        """Карта по имени-или-алиасу в режиме по имени-или-алиасу.

        Заменяет три хардкод-словаря переводов в parser-service; `aliases`
        наполняются синком OverFast (герои) и админкой (карты, режимы).
        """
        return (
            sa.select(models.Map)
            .join(models.Gamemode)
            .where(
                sa.or_(models.Map.name == name, models.Map.aliases.contains([name])),
                sa.or_(models.Gamemode.name == gamemode, models.Gamemode.aliases.contains([gamemode])),
            )
        )

    async def get_by_name_or_alias_and_gamemode(
        self, session: AsyncSession, *, name: str, gamemode: str, with_gamemode: bool = False
    ) -> models.Map | None:
        query = self.build_name_or_alias_query(name=name, gamemode=gamemode)
        if with_gamemode:
            query = query.options(selectinload(models.Map.gamemode))
        result = await session.execute(query)
        return result.scalar_one_or_none()
```

`get_by_name_and_gamemode` **оставить** — им пользуется `parser-service/src/services/map/service.py:48`; трогать его незачем.

Индекса по `aliases` нет умышленно:

```python
    # ponytail: без GIN-индекса по aliases — ~45 карт и ~10 режимов, запрос раз
    # на лог. Добавить `USING gin (aliases jsonb_path_ops)`, когда карт станут сотни.
```

**Step 4: Запустить тест**

Expected: PASS (4 passed)

**Step 5: Коммит**

```bash
rtk git add backend/shared/repository/catalog.py backend/parser-service/tests/test_catalog_aliases.py
rtk git commit -m "feat(catalog): resolve maps and gamemodes by name or alias"
```

---

## Task 4: Запись промахов

**Files:**
- Create: `backend/parser-service/src/services/catalog_aliases.py`
- Test: `backend/parser-service/tests/test_catalog_alias_misses.py`

**Step 1: Написать падающий тест**

Проверяем три контракта: собственная сессия, апсерт с инкрементом, глушение своих ошибок.

```python
class RecordMissesTests(IsolatedAsyncioTestCase):
    async def test_it_upserts_in_its_own_session_and_commits(self) -> None:
        session = AsyncMock()
        session.__aenter__.return_value = session
        with patch.object(catalog_aliases.db, "async_session_maker", return_value=session):
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, ["Ана"], log_record_id=7)
        session.execute.assert_awaited_once()
        session.commit.assert_awaited_once()

    async def test_the_statement_increments_occurrences_on_conflict(self) -> None:
        statement = catalog_aliases.build_miss_upsert(
            shared_enums.CatalogEntityType.map, ["Илиос", "Гавана"], log_record_id=None
        )
        sql = str(statement.compile(dialect=postgresql.dialect()))
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("uq_catalog_alias_miss_entity_raw", sql)
        self.assertIn("occurrences", sql.split("DO UPDATE")[1])
        self.assertIn("resolved_at", sql.split("DO UPDATE")[1])

    async def test_an_empty_name_set_does_not_open_a_session(self) -> None:
        with patch.object(catalog_aliases.db, "async_session_maker") as factory:
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, [])
        factory.assert_not_called()

    async def test_a_failure_is_swallowed(self) -> None:
        with patch.object(catalog_aliases.db, "async_session_maker", side_effect=RuntimeError("db down")):
            await catalog_aliases.record_misses(shared_enums.CatalogEntityType.hero, ["Ана"])
        # не поднялось — значит не подменит исходную ошибку обработки лога
```

**Step 2: Запустить, убедиться что падает**

Run: `cd backend && rtk uv run python -m pytest parser-service/tests/test_catalog_alias_misses.py -q`
Expected: FAIL — модуля нет.

**Step 3: Реализовать**

```python
"""Очередь нераспознанных имён каталога из match-логов.

Промах пишется в СОБСТВЕННОЙ транзакции: у карты и режима он предшествует
404, который откатит сессию обработки лога, — общая сессия потеряла бы запись.
Сама запись best-effort: её сбой логируется и никогда не подменяет исходную
ошибку обработки.
"""

MISS_NAME_MAX_LENGTH = 128


def build_miss_upsert(entity_type, raw_names, *, log_record_id=None) -> Insert:
    rows = [
        {"entity_type": entity_type, "raw_name": name[:MISS_NAME_MAX_LENGTH], "last_log_record_id": log_record_id}
        for name in sorted({n.strip() for n in raw_names if n and n.strip()})
    ]
    statement = pg_insert(models.CatalogAliasMiss).values(rows)
    return statement.on_conflict_do_update(
        constraint="uq_catalog_alias_miss_entity_raw",
        set_={
            "occurrences": models.CatalogAliasMiss.occurrences + 1,
            "last_seen_at": sa.func.now(),
            "last_log_record_id": statement.excluded.last_log_record_id,
            # Повторное появление переоткрывает скрытый промах — «скрыл, а оно
            # снова лезет» должно быть видно, а не потеряться.
            "resolved_at": None,
        },
    )


async def record_misses(entity_type, raw_names, *, log_record_id=None) -> None:
    names = {n.strip() for n in raw_names if n and n.strip()}
    if not names:
        return
    try:
        async with db.async_session_maker() as session:
            await session.execute(build_miss_upsert(entity_type, names, log_record_id=log_record_id))
            await session.commit()
    except Exception as exc:
        logger.warning("failed to record %s alias misses %s: %s", entity_type.value, sorted(names), exc)
```

`build_miss_upsert` вынесен из `record_misses` только чтобы тестировать SQL без БД.

**Step 4: Запустить тест**

Expected: PASS (4 passed)

**Step 5: Коммит**

```bash
rtk git add backend/parser-service/src/services/catalog_aliases.py backend/parser-service/tests/test_catalog_alias_misses.py
rtk git commit -m "feat(parser): record unresolved catalog names in their own transaction"
```

---

## Task 5: Разрешение и промахи в обработчике логов

**Files:**
- Modify: `backend/parser-service/src/services/match_logs/flows.py:95-113` (`__init__`), `:246-258` (`get_map`), `:260-279` (`_preload_data`, `get_hero`), `:1026-1028` (`start`)
- Modify: `backend/parser-service/src/services/map/flows.py:29-41`
- Test: `backend/parser-service/tests/test_match_log_alias_resolution.py`

**Step 1: Написать падающий тест**

```python
class AliasResolutionTests(IsolatedAsyncioTestCase):
    def _processor(self):
        proc = flows.MatchLogProcessor.__new__(flows.MatchLogProcessor)
        proc.heroes_map = {}
        proc.hero_misses = set()
        proc.log_record_id = 11
        return proc

    async def test_preload_folds_db_aliases_into_the_hero_cache(self) -> None:
        ana = SimpleNamespace(name="Ana", aliases=["Ана", "アナ"])
        proc = self._processor()
        with patch.object(flows.hero_service, "get_all", AsyncMock(return_value=([ana], 1))):
            await proc._preload_data(Mock())
        self.assertIs(ana, proc.heroes_map["Ана"])
        self.assertIs(ana, proc.heroes_map["アナ"])
        self.assertIs(ana, proc.heroes_map["Ana"])

    def test_an_unknown_hero_is_queued_as_a_miss_and_still_raises(self) -> None:
        proc = self._processor()
        with self.assertRaises(errors.ApiHTTPException):
            proc.get_hero("Хтоническая Сущность")
        self.assertEqual({"Хтоническая Сущность"}, proc.hero_misses)

    def test_the_canonical_name_never_needs_an_alias(self) -> None:
        proc = self._processor()
        proc.heroes_map = {"Ana": SimpleNamespace(name="Ana")}
        self.assertEqual("Ana", proc.get_hero("Ana").name)
        self.assertEqual(set(), proc.hero_misses)

    async def test_an_unknown_map_records_the_miss_before_raising(self) -> None:
        recorded = []

        async def fake_record(entity_type, names, *, log_record_id=None):
            recorded.append((entity_type, sorted(names), log_record_id))

        with (
            patch.object(map_flows.service, "get_by_name_or_alias_and_gamemode", AsyncMock(return_value=None)),
            patch.object(map_flows.catalog_aliases, "record_misses", fake_record),
            self.assertRaises(errors.ApiHTTPException),
        ):
            await map_flows.get_by_name_or_alias_and_gamemode(Mock(), "Хогвартс", "Контроль", log_record_id=11)

        self.assertEqual(
            [(shared_enums.CatalogEntityType.map, ["Хогвартс"], 11), (shared_enums.CatalogEntityType.gamemode, ["Контроль"], 11)],
            recorded,
        )

    async def test_start_flushes_the_hero_misses_once(self) -> None:
        # см. Step 3: сброс стоит после create_stats; здесь проверяется один
        # батчевый вызов, а не по одному на промах
```

**Step 2: Запустить, убедиться что падает**

Run: `cd backend && rtk uv run python -m pytest parser-service/tests/test_match_log_alias_resolution.py -q`
Expected: FAIL

**Step 3: Реализовать**

`MatchLogProcessor.__init__` — новое поле рядом с `self.heroes_map`:

```python
        # Имена героев, которых нет ни в каноне, ни в алиасах. Копятся здесь,
        # а не пишутся сразу: get_hero синхронный (await невозможен) и
        # вызывается на каждый килл-ивент. Сбрасывается батчем в start().
        self.hero_misses: set[str] = set()
```

`_preload_data` — вместо `enums.hero_translation`:

```python
        self.heroes_map = {}
        for hero in heroes_db:
            self.heroes_map[hero.name] = hero
            for alias in hero.aliases:
                self.heroes_map.setdefault(alias, hero)
```

`setdefault`, а не `[alias] =`: каноническое имя одного героя никогда не перетирается алиасом другого.

`get_hero` — без словаря, с накоплением промаха:

```python
    def get_hero(self, hero_name: str) -> models.Hero:
        hero = self.heroes_map.get(hero_name)
        if not hero:
            # Промах здесь мягкий: все три вызова его глушат (килл пропущен,
            # hero_id=None, строка статистики пропущена). Поэтому имя обязано
            # попасть в очередь — иначе потеря данных видна только в логах.
            self.hero_misses.add(hero_name)
            raise errors.ApiHTTPException(...)
        return hero
```

`get_map` — без словарей, сырые имена уходят в разрешение:

```python
        gamemode_raw, map_name_raw = row_data[1], row_data[0]
        return await map_flows.get_by_name_or_alias_and_gamemode(
            session, map_name_raw, gamemode_raw, log_record_id=self.log_record_id
        )
```

`start()` — сброс сразу после `create_stats` (строка `:1027`), до финального `commit`, чтобы запись доживала и до успеха, и до отката:

```python
        if self.hero_misses:
            await catalog_aliases.record_misses(
                shared_enums.CatalogEntityType.hero, self.hero_misses, log_record_id=self.log_record_id
            )
```

`map/flows.py` — новая функция рядом с существующей `get_by_name_and_gamemode` (её не удалять, ею пользуется `map/service.py`):

```python
async def get_by_name_or_alias_and_gamemode(
    session: AsyncSession, name: str, gamemode: str, *, log_record_id: int | None = None
) -> models.Map:
    map = await service.get_by_name_or_alias_and_gamemode(session, name, gamemode)
    if not map:
        # Промах записывается ДО raise и в своей транзакции: 404 откатит
        # сессию обработки лога. Оба имени — неизвестно, какое из двух чужое.
        await catalog_aliases.record_misses(enums.CatalogEntityType.map, [name], log_record_id=log_record_id)
        await catalog_aliases.record_misses(enums.CatalogEntityType.gamemode, [gamemode], log_record_id=log_record_id)
        raise errors.ApiHTTPException(status_code=404, detail=[...])
    return map
```

Прокинуть метод в `map/service.py` тонкой обёрткой над репозиторием, как сделан `get_by_name_and_gamemode` (`service.py:48`).

**Step 4: Запустить тесты**

```bash
cd backend && rtk uv run python -m pytest parser-service/tests/test_match_log_alias_resolution.py parser-service/tests/test_match_log_parser.py parser-service/tests/test_impact_pipeline_wiring.py -q
```
Expected: PASS

**Step 5: Коммит**

```bash
rtk git add backend/parser-service/src/services backend/parser-service/tests/test_match_log_alias_resolution.py
rtk git commit -m "feat(parser): resolve log names from catalog aliases and queue misses"
```

---

## Task 6: Удалить словари

**Files:**
- Modify: `backend/parser-service/src/core/enums.py` — удалить `game_mode_dict` (`:25-33`), `map_name_dict` (`:36-80`), `hero_translation` (`:83-137`)

**Step 1: Убедиться, что импортёров не осталось**

```bash
rtk grep -rn "game_mode_dict\|map_name_dict\|hero_translation" backend/ frontend/ gateway/
```
Expected: только `backend/migrations/versions/catalias0001_add_catalog_aliases.py` (докстринг) — иначе остались вызовы, и Task 5 неполна.

**Step 2: Удалить**

`log_stats_index_map` **оставить** — это индексы колонок лога, не перевод.

**Step 3: Прогнать весь набор тестов парсера**

```bash
cd backend && rtk uv run python -m pytest parser-service/tests -q
```
Expected: PASS, ни одного `NameError`.

**Step 4: Коммит**

```bash
rtk git add backend/parser-service/src/core/enums.py
rtk git commit -m "refactor(parser): drop hardcoded map, hero and gamemode translation dicts"
```

---

## Task 7: Синк героев по локалям

**Files:**
- Modify: `backend/parser-service/src/services/hero/flows.py`
- Test: `backend/parser-service/tests/test_hero_locale_sync.py`

**Step 1: Написать падающий тест**

```python
class HeroLocaleSyncTests(IsolatedAsyncioTestCase):
    def test_all_thirteen_blizzard_locales_are_covered(self) -> None:
        self.assertEqual(
            {"de-de", "en-gb", "en-us", "es-es", "es-mx", "fr-fr", "it-it",
             "ja-jp", "ko-kr", "pl-pl", "pt-br", "ru-ru", "zh-tw"},
            {hero_flows.CANONICAL_LOCALE, *hero_flows.ALIAS_LOCALES},
        )
        self.assertNotIn(hero_flows.CANONICAL_LOCALE, hero_flows.ALIAS_LOCALES)

    def test_the_request_is_keyed_on_locale_not_role(self) -> None:
        source = inspect.getsource(hero_flows.fetch_heroes)
        self.assertIn("locale=", source)
        self.assertNotIn("role=", source)

    def test_aliases_union_existing_and_exclude_the_canonical_name(self) -> None:
        merged = hero_flows.merge_aliases(existing=["Ана"], localized={"Ana", "アナ", "Ана"}, canonical="Ana")
        self.assertEqual(["Ана", "アナ"], merged)

    def test_a_manual_alias_survives_a_sync(self) -> None:
        merged = hero_flows.merge_aliases(existing=["Анка"], localized={"Ана"}, canonical="Ana")
        self.assertIn("Анка", merged)
```

**Step 2: Запустить, убедиться что падает**

Expected: FAIL — `CANONICAL_LOCALE` / `merge_aliases` нет.

**Step 3: Реализовать**

```python
# Все локали Blizzard, которые отдаёт OverFast (GET /heroes?locale=). Логи
# приходят на локали клиента игрока, поэтому берутся все — 12 лишних запросов
# раз в синк против молча потерянной статистики.
CANONICAL_LOCALE = "en-us"
ALIAS_LOCALES = ("de-de", "en-gb", "es-es", "es-mx", "fr-fr", "it-it",
                 "ja-jp", "ko-kr", "pl-pl", "pt-br", "ru-ru", "zh-tw")


async def fetch_heroes(locale: str = CANONICAL_LOCALE) -> list[schemas.OverfastHero]:
    # `role` в payload приходит при любом фильтре, поэтому ?role= не нужен:
    # один запрос на локаль вместо одного на роль.
    ... f"{config.settings.overfast_base_url}/heroes?locale={locale}"


def merge_aliases(*, existing: Iterable[str], localized: Iterable[str], canonical: str) -> list[str]:
    """Объединение существующих и локализованных имён без канонического.

    ponytail: только доливает, никогда не удаляет — у алиаса нет провенанса,
    поэтому синк не может отличить свою устаревшую запись от ручной. Когда
    OverFast переименует героя, устаревший алиас снимается через админку.
    """
    return sorted({*existing, *localized} - {canonical})
```

`initial_create`: `canonical = await fetch_heroes()`; затем по `ALIAS_LOCALES` собрать `localized: dict[str, set[str]]` по `hero.key`; затем для новых героев `aliases=merge_aliases(existing=[], ...)`, для существующих — переприсваивание `hero_db.aliases = merge_aliases(existing=hero_db.aliases, ...)` (JSONB не видит in-place мутаций!). Существующие строки по-прежнему не меняют `name` / `image_path` / `type` — минимальный диф.

Для этого нужен доступ к существующим строкам по slug: заменить `service.get_existing_slugs` на выборку моделей (`dict[str, models.Hero]`) — иначе алиасы существующих героев обновить нечем.

**Step 4: Запустить тесты**

Expected: PASS (4 passed)

**Step 5: Проверить против живого OverFast**

```bash
cd backend && rtk uv run python -c "
import asyncio, httpx
async def main():
    async with httpx.AsyncClient(timeout=30) as c:
        en = {h['key']: h['name'] for h in (await c.get('https://overfast.craazzzyyfoxx.me/heroes?locale=en-us')).json()}
        ru = {h['key']: h['name'] for h in (await c.get('https://overfast.craazzzyyfoxx.me/heroes?locale=ru-ru')).json()}
    print(len(en), 'heroes; sample:', [(en[k], ru[k]) for k in list(en)[:3]])
    assert set(en) == set(ru), set(en) ^ set(ru)
asyncio.run(main())"
```
Expected: одинаковый набор ключей, пары вида `('Ana', 'Ана')`.

**Step 6: Коммит**

```bash
rtk git add backend/parser-service/src/services/hero backend/parser-service/tests/test_hero_locale_sync.py
rtk git commit -m "feat(parser): sync hero aliases from all OverFast locales"
```

---

## Task 8: `aliases` в админ-схемах и сервисах app-service

**Files:**
- Modify: `backend/app-service/src/schemas/admin/{hero,map,gamemode}.py`
- Modify: `backend/app-service/src/schemas/{hero,map,gamemode}.py` — `aliases: list[str] = []` в `*Read`
- Modify: `backend/app-service/src/services/admin/{hero,map,gamemode}.py`
- Test: `backend/app-service/tests/test_catalog_alias_admin.py`

**Step 1: Написать падающий тест**

```python
    def test_create_and_update_accept_aliases(self) -> None:
        for schema in (admin_hero.HeroCreate, admin_map.MapCreate, admin_gamemode.GamemodeCreate):
            self.assertIn("aliases", schema.model_fields)

    def test_read_schemas_expose_aliases(self) -> None:
        for schema in (schemas.HeroRead, schemas.MapRead, schemas.GamemodeRead):
            self.assertIn("aliases", schema.model_fields)

    def test_aliases_are_stripped_deduped_and_order_preserving(self) -> None:
        self.assertEqual(
            ["Ана", "アナ"],
            hero_service.normalize_aliases(["  Ана ", "", "アナ", "Ана", "   "]),
        )
```

**Step 2: Запустить, убедиться что падает**

Run: `cd backend && rtk uv run python -m pytest app-service/tests/test_catalog_alias_admin.py -q`

**Step 3: Реализовать**

`aliases: list[str] | None = None` в шести `*Create`/`*Update`; `aliases: list[str] = []` в трёх `*Read`.

Нормализация — одна функция в `shared`, чтобы три сервиса не расходились (`shared/services/catalog_aliases.py` или рядом с моделью):

```python
def normalize_aliases(values: Iterable[str]) -> list[str]:
    """strip, отброс пустых, дедуп с сохранением порядка ввода."""
    seen: dict[str, None] = {}
    for value in values:
        cleaned = value.strip()
        if cleaned:
            seen.setdefault(cleaned, None)
    return list(seen)
```

В `create_*` — `aliases=normalize_aliases(data.aliases or [])`. В `update_*` — обработать до `update_fields`, переприсваиванием:

```python
    update_data = data.model_dump(exclude_unset=True)
    if "aliases" in update_data:
        update_data["aliases"] = normalize_aliases(update_data["aliases"] or [])
```

`update_hero` уже строит `update_data` и вынимает `role` (`services/admin/hero.py:77-81`) — вписаться туда же. `update_map` / `update_gamemode` — проверить, как они применяют поля, и повторить.

Про попадание в публичный payload:

```python
    # ponytail: aliases едут и в публичный GET /api/v1/heroes (~600 лишних
    # строк на кешированном сутки эндпоинте). Отдельные *AdminRead схемы —
    # когда payload станет заметен; сейчас это 4-й параметр _register_entity.
```

**Step 4: Запустить тест**

Expected: PASS

**Step 5: Коммит**

```bash
rtk git add backend/app-service/src backend/shared backend/app-service/tests/test_catalog_alias_admin.py
rtk git commit -m "feat(app): expose catalog aliases in the metadata admin CRUD"
```

---

## Task 9: RPC очереди промахов

**Files:**
- Create: `backend/app-service/src/rpc/catalog_aliases.py`
- Modify: `backend/app-service/serve.py:25-40` (импорт), `:70-75` (регистрация)
- Modify: `backend/app-service/src/openapi_docs.py`, `backend/app-service/src/openapi_schemas.py`
- Create: `backend/app-service/src/schemas/admin/catalog_alias.py`
- Test: `backend/app-service/tests/test_catalog_alias_rpc.py`

**Step 1: Написать падающий тест**

```python
    def test_the_three_subjects_are_registered(self) -> None:
        broker = _RecordingBroker()
        catalog_aliases_rpc.register(broker, logging.getLogger())
        self.assertEqual(
            {
                "rpc.app.catalog_aliases.misses_list",
                "rpc.app.catalog_aliases.attach",
                "rpc.app.catalog_aliases.dismiss",
            },
            set(broker.subjects),
        )

    def test_every_subject_is_documented_and_typed(self) -> None:
        for subject in (...):
            self.assertIn(subject, openapi_docs.OPERATION_DOCS)
            self.assertIn(subject, openapi_schemas.OPERATIONS)

    def test_attach_requires_entity_type_id_and_alias(self) -> None:
        with self.assertRaises(ValidationError):
            schemas.CatalogAliasAttach.model_validate({"entity_type": "hero"})
```

Точные имена таблиц `OPERATION_DOCS` / `OPERATIONS` подсмотреть в `openapi_docs.py` / `openapi_schemas.py` — не угадывать.

**Step 2: Запустить, убедиться что падает**

**Step 3: Реализовать**

`src/schemas/admin/catalog_alias.py`: `CatalogAliasMissRead`, `CatalogAliasMissListQueryParams` (`entity_type: CatalogEntityType | None`, `include_resolved: bool = False`), `CatalogAliasAttach` (`entity_type`, `entity_id`, `alias: str = Field(min_length=1, max_length=128)`), `CatalogAliasMissListResponse`.

`src/rpc/catalog_aliases.py` — по образцу `metadata_admin.py`: `_SF = db.async_session_maker`, `_gate` = `c.require_superuser(c.actor(data))`, каждый хендлер через `c.envelope(logger, "<subject>", op, session_factory=_SF)`.

- `misses_list` — `resolved_at IS NULL` по умолчанию, `ORDER BY occurrences DESC, last_seen_at DESC`, фильтр по `entity_type`.
- `attach` — **одна транзакция**: взять сущность по `entity_type`+`entity_id`, `obj.aliases = normalize_aliases([*obj.aliases, alias])`, затем `UPDATE catalog_alias_miss SET resolved_at = now() WHERE entity_type = :t AND raw_name = :alias`, потом `commit`. Именно поэтому это отдельный RPC, а не `PATCH aliases` из браузера — клиентский read-modify-write гоняется между двумя админами.
- `dismiss` — `resolved_at = now()` по `id`.

Зарегистрировать в `serve.py` рядом с `metadata_admin.register(broker, logger)`; дописать записи в `openapi_docs.py` (секция `# ── metadata admin`) и `openapi_schemas.py` (`Op(request=..., response=...)`).

**Step 4: Запустить тесты**

```bash
cd backend && rtk uv run python -m pytest app-service/tests -q
```
Expected: PASS

**Step 5: Коммит**

```bash
rtk git add backend/app-service
rtk git commit -m "feat(app): admin RPC for the catalog alias-miss queue"
```

---

## Task 10: Маршруты gateway + манифест OpenAPI

**Files:**
- Modify: `gateway/internal/app/metadata_admin_routes.go`
- Modify: `gateway/internal/openapi/schemas.json` (регенерация, не руками)

**Step 1: Дописать маршруты**

В **существующую** таблицу `MetadataAdminRoutes` — новой таблицы не создавать, тогда `apidocs/groups.go:54-55` и `edge/apiv1_guard_test.go:59` уже её подхватывают:

```go
	// alias-miss queue: unresolved log names + one-click attach
	{Method: "GET", Pattern: "/api/v1/admin/catalog-aliases/misses", Queue: "rpc.app.catalog_aliases.misses_list", AllQuery: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/catalog-aliases/attach", Queue: "rpc.app.catalog_aliases.attach", Body: true, Auth: edge.AuthRequired},
	{Method: "POST", Pattern: "/api/v1/admin/catalog-aliases/misses/{id}/dismiss", Queue: "rpc.app.catalog_aliases.dismiss", IDParam: "id", Auth: edge.AuthRequired},
```

**Step 2: Прогнать тесты gateway**

Run: `rtk go test ./gateway/...`
Expected: PASS. Конфликт паттернов `ServeMux` роняет gateway на старте — ловит именно `apiv1_guard_test.go`.

**Step 3: Регенерировать манифест**

```bash
rtk bash backend/scripts/export_openapi_schemas.sh
```

Ожидать диф **больше** своего изменения: CI-гарда на `schemas.json` нет, манифест уже дрейфовал раньше (`docs/superpowers/plans/2026-08-04-workspace-discord-guild.md:1056`). Так и написать в сообщении коммита, а не делать вид, что весь диф свой — генератор всё-или-ничего, разделить нельзя.

**Step 4: Проверить, что записи реально попали**

```bash
jq -r '.operations | keys[] | select(startswith("rpc.app.catalog_aliases"))' gateway/internal/openapi/schemas.json
jq -r '[.schemas | to_entries[] | select((.value.properties // {}) | has("aliases")) | .key] | .[]' gateway/internal/openapi/schemas.json
```
Expected: три subject-а в первом выводе; во втором — `app.HeroRead`, `app.MapRead`, `app.GamemodeRead` и шесть `*Create`/`*Update`. Отсутствующая запись деградирует до generic `object` **молча** — проверять, не предполагать.

**Step 5: Коммит**

```bash
rtk git add gateway/internal/app/metadata_admin_routes.go gateway/internal/openapi/schemas.json
rtk git commit -m "feat(gateway): expose the catalog alias-miss queue routes"
```

---

## Task 11: Поле алиасов в трёх админ-диалогах

**Files:**
- Modify: `frontend/src/types/admin.types.ts:853-896` (`{Hero,Map,Gamemode}{Create,Update}Input`)
- Modify: `frontend/src/types/{hero,map,gamemode}.types.ts` — `aliases: string[]`
- Modify: `frontend/src/app/admin/{heroes,maps,gamemodes}/page.tsx`
- Test: `frontend/src/app/admin/__tests__/catalog-aliases.test.ts`

**Step 1: Написать падающий тест**

Тестируется только парсер поля — по строке на алиас, без похода в DOM:

```ts
it("parses one alias per line, trimming and dropping blanks and duplicates", () => {
  expect(parseAliasesInput("Ана\n  アナ  \n\nАна\n")).toEqual(["Ана", "アナ"]);
});

it("round-trips through the textarea value", () => {
  expect(formatAliasesInput(["Ана", "アナ"])).toBe("Ана\nアナ");
});
```

**Step 2: Запустить, убедиться что падает**

Run: `cd frontend && rtk npx vitest run src/app/admin/__tests__/catalog-aliases.test.ts`

**Step 3: Реализовать**

`parseAliasesInput` / `formatAliasesInput` — один общий модуль (`frontend/src/lib/catalog-aliases.ts`), а не три копии в страницах. В каждую из трёх страниц: `aliases` в `empty*Form`, `<Textarea>` в `EntityFormDialog` с подписью «One alias per line — names as they appear in match logs», колонка-`Badge` с количеством алиасов в `AdminDataTable`. `hasUnsavedChanges` (`@/lib/form-change`) уже сравнивает объекты формы — массив поедет туда без изменений, но проверить на пустом vs `[]`.

**Step 4: Запустить тесты и типы**

```bash
cd frontend && rtk npx vitest run src/app/admin/__tests__/catalog-aliases.test.ts && rtk npx tsc --noEmit
```

**Step 5: Коммит**

```bash
rtk git add frontend/src
rtk git commit -m "feat(admin): edit catalog aliases from the hero, map and gamemode dialogs"
```

---

## Task 12: Страница `/admin/aliases`

**Files:**
- Create: `frontend/src/app/admin/aliases/page.tsx`
- Modify: `frontend/src/services/admin.service.ts`
- Modify: навигация админки (найти через `rtk grep -rn "admin/gamemodes" frontend/src --include=*.tsx | grep -i nav`)

**Step 1: Реализовать**

`AdminDataTable` с колонками: Type (`Badge`), Raw name (`<code>`), Times seen, Last seen, Last log (ссылка на запись при `last_log_record_id`). В строке — searchable `Select` по сущностям того же типа (`adminService.getHeroes/getMaps/getGamemodes`) и две кнопки: `Attach` (`POST /admin/catalog-aliases/attach`) и `Dismiss`. `useMutation` с `queryClient.invalidateQueries` на очередь **и** на список сущностей. Фильтр по типу + переключатель `Show resolved`.

Тест на страницу не пишем — логика в `catalog-aliases.ts` (Task 11) и в RPC (Task 9) уже покрыта; здесь только композиция UI.

**Step 2: Типы и сборка**

```bash
cd frontend && rtk npx tsc --noEmit && rtk npx next build --no-lint
```

**Step 3: Коммит**

```bash
rtk git add frontend/src
rtk git commit -m "feat(admin): alias-miss queue page with one-click attach"
```

---

## Task 13: Верификация

**Step 1: Полные наборы тестов**

```bash
cd backend && rtk uv run python -m pytest parser-service/tests app-service/tests -q
cd backend && rtk uv run ruff check . && rtk uv run ruff format --check .
rtk go test ./gateway/...
cd frontend && rtk npx vitest run && rtk npx tsc --noEmit
```

**Step 2: Дымовой прогон обработки лога — главная проверка**

Тестов недостаточно: смысл фичи в том, что реальный лог с русскими именами парсится **без** словарей.

```bash
rtk make dev-up-full
```

1. Найти лог с русскими именами карты и героев (`backend/parser-service/logs/`, S3 или `/admin/tournaments/{id}/matches/logs`).
2. Залить его через `/admin/tournaments/{id}/matches/logs` и убедиться, что запись доходит до `done`, а у матча проставлена та же карта, что и до изменения.
3. Проверить, что `overwatch.catalog_alias_miss` пуст после успешного лога:
   ```sql
   select entity_type, raw_name, occurrences from overwatch.catalog_alias_miss order by occurrences desc;
   ```

**Step 3: Дымовой прогон очереди промахов**

1. Подсунуть лог с заведомо несуществующей картой (скопировать рабочий, заменить имя карты в строке `match_start`) → запись падает на `failed`, в `catalog_alias_miss` появляются две строки (`map` + `gamemode`).
2. `/admin/aliases` показывает их; `Attach` на правильную карту → алиас появился в `/admin/maps`, промах закрыт.
3. Перезалить тот же лог → проходит.
4. Залить ещё раз лог с несуществующим **героем** → запись доходит до `done` (мягкий промах), но `catalog_alias_miss` содержит строку `hero` с `occurrences = 1`. Залить снова → `occurrences = 2`. Это и есть ранее невидимая потеря данных.

**Step 4: Дымовой прогон синка**

`POST /api/v1/admin/heroes/update` (subject `rpc.parser.metadata.sync_heroes`) под суперадмином → 200, затем:
```sql
select name, jsonb_array_length(aliases) from overwatch.hero order by 2 desc limit 5;
```
Expected: ≥ 10 алиасов у большинства героев (13 локалей минус совпадения). Ручной алиас, добавленный на шаге 3, обязан выжить.

**Step 5: Документация**

- `docs/database_erd.md` — блок `CATALOG_ALIAS_MISS`, поле `aliases` у `HERO` / `MAP` / `GAMEMODE`, новая ревизия `catalias0001` и новая голова в changelog.
- `frontend/src/app/docs/diagrams.ts` — те же правки в mermaid-схеме.
- `backend/parser-service/README.md` — в описании синка OverFast: герои синкаются по 13 локалям и наполняют `hero.aliases`; карты/режимы — алиасы ручные.

**Step 6: Коммит**

```bash
rtk git add docs frontend/src/app/docs/diagrams.ts backend/parser-service/README.md
rtk git commit -m "chore: catalog aliases verification and docs"
```

---

## Definition of Done

1. `rtk grep -rn "game_mode_dict\|map_name_dict\|hero_translation" backend/` — только докстринг миграции.
2. Реальный лог с русскими именами карты и героев проходит до `done` с той же картой, что до изменения.
3. Лог с неизвестной картой падает, оба имени видны в `/admin/aliases`, `Attach` их закрывает, повторная заливка проходит.
4. Лог с неизвестным героем доходит до `done` и оставляет строку `hero` со счётчиком, который растёт при повторе.
5. Синк героев наполняет `hero.aliases` из 13 локалей и не стирает ручной алиас.
6. Три subject-а `rpc.app.catalog_aliases.*` присутствуют в `gateway/internal/openapi/schemas.json`.
7. `downgrade` миграции применяется без ошибок.
8. Наборы тестов, ruff, `go test ./gateway/...`, `tsc --noEmit`, `vitest` — зелёные.
