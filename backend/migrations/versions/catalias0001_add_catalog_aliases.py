"""Catalog name aliases + unresolved-name queue.

Replaces the three hardcoded translation dicts in ``parser-service``
(``src/core/enums.py``: ``game_mode_dict`` / ``map_name_dict`` /
``hero_translation``) with data: an ``aliases`` JSONB array on the catalog
entities plus a queue of names no alias resolved. After this, a new map, a
seasonal map variant or a log from an unfamiliar locale is one admin row, not a
``parser-service`` redeploy.

The dicts below are written out as literals on purpose: the migration must not
import application code, because the dicts are deleted from ``enums.py`` in the
same changeset and the migration still has to apply afterwards.

Revision ID: catalias0001
Revises: mapcomp0001
Create Date: 2026-08-05 13:00:00.000000
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "catalias0001"
down_revision: str | None = "mapcomp0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "overwatch"
ALIASED_TABLES = ("hero", "map", "gamemode")

# ``sa.Enum`` here mirrors ``models.CatalogAliasMiss.entity_type``, declared as
# ``Enum(enums.CatalogEntityType, name="catalogentitytype")`` with no schema —
# so the Postgres type lands in the default (public) schema, not ``overwatch``,
# exactly like ``heroclass`` from the initial revision. Labels are the member
# NAMES (no ``values_callable``), which for this enum equal the values.
ENTITY_TYPE_ENUM = sa.Enum("hero", "map", "gamemode", name="catalogentitytype")

# `game_mode_dict` (7 entries) — every gamemode's Russian name.
GAMEMODE_ALIASES: dict[str, str] = {
    "Осада": "Assault",
    "Натиск": "Push",
    "Сопровождение": "Escort",
    "Точка возгорания": "Flashpoint",
    "Гибридный режим": "Hybrid",
    "Контроль": "Control",
    "Битва": "Clash",
}

# `map_name_dict` (43 entries) — Russian names plus two things a locale would
# never cover: seasonal variants (`Hollywood (Halloween)` -> `Hollywood`) and
# apostrophe normalisation (`King's Row` -> `King’s Row`).
MAP_ALIASES: dict[str, str] = {
    "Blizzard World (зима)": "Blizzard World",
    "Blizzard World (winter)": "Blizzard World",
    "Hollywood (Halloween)": "Hollywood",
    "Голливуд (Хеллоуин)": "Hollywood",
    "King's Row": "King’s Row",
    "King's Row (Winter)": "King’s Row",
    "Lijiang Tower (Lunar New Year)": "Lijiang Tower",
    "Башня Лицзян (Лунный Новый год)": "Lijiang Tower",
    "Circuit royal": "Circuit Royal",
    "Айхенвальд": "Eichenwalde",
    "Антарктический полуостров": "Antarctic Peninsula",
    "Башня Лицзян": "Lijiang Tower",
    "Гавана": "Havana",
    "Голливуд": "Hollywood",
    "Джанкертаун": "Junkertown",
    "Дорадо": "Dorado",
    "Илиос": "Ilios",
    "Кингс Роу": "King’s Row",
    "Кингс Роу (зима)": "King’s Row",
    "Колизей": "Colosseo",
    "Королевская трасса": "Circuit Royal",
    "Мидтаун": "Midtown",
    "Монастырь Шамбала": "Shambali Monastery",
    "Непал": "Nepal",
    "Нумбани": "Numbani",
    "Нью-Джанк": "New Junk City",
    "Нью-Квин-стрит": "New Queen Street",
    "Оазис": "Oasis",
    "Параисо": "Paraíso",
    "Пост наблюдения: Гибралтар": "Watchpoint: Gibraltar",
    "Пусан": "Busan",
    "Риальто": "Rialto",
    "Самоа": "Samoa",
    "Сураваса": "Suravasa",
    "Шоссе 66": "Route 66",
    "Эсперанса": "Esperança",
    "Ханамура": "Hanamura",
    "Рунасапи": "Runasapi",
    "Ханаока": "Hanaoka",
    "Трон Анубиса": "Throne of Anubis",
    "Атлус": "Aatlis",
    "Айхенвальд (Хеллоуин)": "Eichenwalde",
    "Eichenwalde (Halloween)": "Eichenwalde",
}

# `hero_translation` (53 entries) — Russian names plus a couple of English
# misspellings (`Freya` -> `Freja`). Superseded going forward by the OverFast
# sync, which fills `hero.aliases` from all 13 Blizzard locales.
HERO_ALIASES: dict[str, str] = {
    "Кулак Смерти": "Doomfist",
    "Лусио": "Lúcio",
    "Трейсер": "Tracer",
    "Солдат-76": "Soldier: 76",
    "Гэндзи": "Genji",
    "Ана": "Ana",
    "Ангел": "Mercy",
    "Ориса": "Orisa",
    "Заря": "Zarya",
    "Соджорн": "Sojourn",
    "Роковая Вдова": "Widowmaker",
    "Эш": "Ashe",
    "Кэссиди": "Cassidy",
    "Батист": "Baptiste",
    "Симметра": "Symmetra",
    "Мойра": "Moira",
    "Хандзо": "Hanzo",
    "Уинстон": "Winston",
    "Жнец": "Reaper",
    "Фарра": "Pharah",
    "Турбосвин": "Roadhog",
    "Бригитта": "Brigitte",
    "Ткач Жизни": "Lifeweaver",
    "Торбьорн": "Torbjörn",
    "Королева Стервятников": "Junker Queen",
    "Эхо": "Echo",
    "Иллари": "Illari",
    "Мауга": "Mauga",
    "Таран": "Wrecking Ball",
    "Раматтра": "Ramattra",
    "Мэй": "Mei",
    "Дзенъятта": "Zenyatta",
    "Райнхардт": "Reinhardt",
    "Сигма": "Sigma",
    "Крысавчик": "Junkrat",
    "Сомбра": "Sombra",
    "Авентюра": "Venture",
    "Кирико": "Kiriko",
    "Бастион": "Bastion",
    "Юнона": "Juno",
    "Азарт": "Hazard",
    "Фрейя": "Freja",
    "Freya": "Freja",
    "Вендетта": "Vendetta",
    "У Ян": "Wuyang",
    "Ань Жань": "Anran",
    "Мидзуки": "Mizuki",
    "Домина": "Domina",
    "Амре": "Emre",
    "Реактивная киса": "Jetpack Cat",
    "Эмре": "Emre",
    "Реактивная Киса": "Jetpack Cat",
    "Сьерра": "Sierra",
}


def _seed(table: str, mapping: dict[str, str]) -> None:
    """Fold ``alias -> canonical`` pairs into ``overwatch.<table>.aliases``.

    One UPDATE per canonical name, not per alias: the whole array is written at
    once. ``RETURNING id`` is the only way to tell "seeded" from "there is no
    such row" — a canonical name missing from the catalog would otherwise drop
    its aliases silently, so every miss is printed for the operator to triage.
    """
    conn = op.get_bind()
    by_canonical: dict[str, list[str]] = {}
    for alias, canonical in mapping.items():
        # An alias equal to `name` is dead weight: the lookup already matches on
        # `name`, so `aliases @> [name]` would only duplicate the predicate.
        if alias != canonical:
            by_canonical.setdefault(canonical, []).append(alias)

    for canonical, aliases in by_canonical.items():
        # `table` comes from the literal tuples in this file, never from input.
        # CAST(:aliases AS jsonb), not `:aliases::jsonb`: SQLAlchemy's text()
        # bind-parameter scanner does not match a name followed immediately by
        # `::`, so the postgres shorthand ships the literal ":aliases" to the
        # server and the statement dies with a syntax error.
        statement = sa.text(
            f"UPDATE {SCHEMA}.{table} SET aliases = CAST(:aliases AS jsonb) WHERE name = :canonical RETURNING id"
        )
        row = conn.execute(statement, {"aliases": json.dumps(sorted(set(aliases))), "canonical": canonical}).first()
        if row is None:
            print(f"catalias0001: {SCHEMA}.{table} has no row named {canonical!r}; {len(aliases)} alias(es) skipped")


def upgrade() -> None:
    for table in ALIASED_TABLES:
        op.add_column(
            table,
            sa.Column("aliases", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
            schema=SCHEMA,
        )

    # Column types mirror db.TimeStampIntegerMixin exactly: BigInteger pk,
    # created_at with a server default, updated_at nullable with NO server
    # default (the mixin sets it via onupdate).
    op.create_table(
        "catalog_alias_miss",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entity_type", ENTITY_TYPE_ENUM, nullable=False),
        sa.Column("raw_name", sa.String(length=128), nullable=False),
        sa.Column("occurrences", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # Breadcrumb for triage, not a dependency: SET NULL, and the log record
        # id is BigInteger because log_processing.record uses the same mixin.
        sa.Column("last_log_record_id", sa.BigInteger(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["last_log_record_id"], ["log_processing.record.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("entity_type", "raw_name", name="uq_catalog_alias_miss_entity_raw"),
        schema=SCHEMA,
    )

    _seed("hero", HERO_ALIASES)
    _seed("map", MAP_ALIASES)
    _seed("gamemode", GAMEMODE_ALIASES)


def downgrade() -> None:
    op.drop_table("catalog_alias_miss", schema=SCHEMA)
    for table in ALIASED_TABLES:
        op.drop_column(table, "aliases", schema=SCHEMA)
    ENTITY_TYPE_ENUM.drop(op.get_bind(), checkfirst=True)
