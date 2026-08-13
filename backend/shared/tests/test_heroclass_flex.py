"""Guard the ``flex`` member of ``HeroClass`` and the split it forces.

``heroclass`` is one Postgres type behind three columns with opposite needs:
``tournament.player.role`` may be ``flex`` (a player who holds no fixed role,
which is what a role-less roster shape drafts for), while ``overwatch.hero.type``
and ``matches.stat_baselines.role`` may not -- no hero has a class of "flex" and
no baseline can be computed for one. Postgres cannot narrow a shared enum per
column, so the schema layer carries the split as
``HERO_TYPE_CLASSES``/``HeroTypeClass``, mirrored in the database by CHECK
constraints.

These tests pin the Python half: the membership of the narrowed tuple, the static
type derived from it, and the column that actually accepts ``flex``. The
assertions that read the ``heroflex0001`` revision file -- its ``ALTER TYPE``, its
two CHECKs, its label-preserving downgrade -- went away with the ``initial_v6``
squash, which replaced every per-revision file with one generated baseline.
"""

from __future__ import annotations

import typing

import sqlalchemy as sa

from shared import models
from shared.core.enums import HERO_TYPE_CLASSES, HeroClass, HeroTypeClass


class TestPlayerRoleColumn:
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
