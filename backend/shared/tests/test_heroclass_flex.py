"""Guard the ``flex`` member of ``HeroClass`` and the split it forces.

``heroclass`` is one Postgres type behind three columns with opposite needs:
``tournament.player.role`` may be ``flex`` (a player who holds no fixed role,
which is what a role-less roster shape drafts for), while ``overwatch.hero.type``
and ``matches.stat_baselines.role`` may not -- no hero has a class of "flex" and
no baseline can be computed for one. Postgres cannot narrow a shared enum per
column, so the split lives in two places: ``HERO_TYPE_CLASSES``/``HeroTypeClass``
in the schema layer, and CHECK constraints from migration ``heroflex0001``.

These tests pin the three things that would silently break that split: the
stored label the migration writes, the membership of the narrowed tuple, and the
presence of both CHECKs.
"""

from __future__ import annotations

import importlib.util
import pathlib
import typing

import sqlalchemy as sa

from shared import models
from shared.core.enums import HERO_TYPE_CLASSES, HeroClass, HeroTypeClass

MIGRATION = pathlib.Path(__file__).resolve().parents[2] / "migrations" / "versions" / "heroflex0001_heroclass_flex.py"


def _migration_text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _migration_module():
    """Import the revision without alembic's env, for its module constants."""
    spec = importlib.util.spec_from_file_location("heroflex0001_under_test", MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestStoredLabels:
    def test_the_migration_adds_the_label_sqlalchemy_will_actually_write(self):
        # SQLAlchemy persists member NAMES, so the DB label is lowercase `flex`
        # while the Python value is "Flex". Getting this backwards would make
        # every flex insert fail on a type that looks correctly extended.
        assert sa.Enum(HeroClass).enums == ["tank", "damage", "support", "flex"]
        assert HeroClass.flex.value == "Flex"
        # Asserted against the enum rather than spelled a second time: the
        # migration builds its statement from ``_FLEX_LABEL``.
        assert _migration_module()._FLEX_LABEL == HeroClass.flex.name == "flex"
        assert "ALTER TYPE heroclass ADD VALUE IF NOT EXISTS" in _migration_text()

    def test_revision_chains_off_the_previous_head(self):
        module = _migration_module()
        assert module.revision == "heroflex0001"
        assert module.down_revision == "audit0001"

    def test_player_role_is_the_column_that_gained_the_value(self):
        role = models.Player.__table__.c.role
        assert isinstance(role.type, sa.Enum)
        assert role.type.enum_class is HeroClass
        assert role.nullable is True


class TestHeroSideNarrowing:
    def test_hero_type_classes_is_heroclass_without_flex(self):
        assert HERO_TYPE_CLASSES == (HeroClass.tank, HeroClass.damage, HeroClass.support)
        assert HeroClass.flex not in HERO_TYPE_CLASSES
        assert set(HERO_TYPE_CLASSES) | {HeroClass.flex} == set(HeroClass)

    def test_the_static_type_matches_the_tuple(self):
        assert typing.get_args(HeroTypeClass) == HERO_TYPE_CLASSES

    def test_both_hero_side_columns_are_check_constrained(self):
        text = _migration_text()
        # Compared as text on purpose: PG12+ forbids USING a freshly added enum
        # value in the same transaction that adds it, so `type <> 'flex'::heroclass`
        # would fail while the cast keeps both statements in one migration.
        assert "type::text <>" in text
        assert "role::text <>" in text
        for table, schema in (("hero", "overwatch"), ("stat_baselines", "matches")):
            assert f'"{table}"' in text
            assert f'schema="{schema}"' in text

    def test_downgrade_keeps_the_label_and_only_drops_the_checks(self):
        # Postgres cannot remove an enum value, so `flex` is forward-only; the
        # constraints are the reversible half. A downgrade that tried to rebuild
        # the type would have to rewrite every dependent column.
        downgrade = _migration_text().split("def downgrade()")[1]
        assert "drop_constraint" in downgrade
        assert "ADD VALUE" not in downgrade
        assert "DROP TYPE" not in downgrade
