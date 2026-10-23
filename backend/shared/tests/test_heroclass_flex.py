"""Character classes and baseline keys exclude the legacy flex enum member."""

from __future__ import annotations

import typing

from shared.core.enums import HERO_TYPE_CLASSES, HeroClass, HeroTypeClass


class TestHeroSideNarrowing:
    def test_hero_type_classes_is_heroclass_without_flex(self):
        assert HERO_TYPE_CLASSES == (HeroClass.tank, HeroClass.damage, HeroClass.support)
        assert HeroClass.flex not in HERO_TYPE_CLASSES
        assert set(HERO_TYPE_CLASSES) | {HeroClass.flex} == set(HeroClass)

    def test_the_static_type_matches_the_tuple(self):
        assert typing.get_args(HeroTypeClass) == HERO_TYPE_CLASSES
