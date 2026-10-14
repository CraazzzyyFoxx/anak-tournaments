"""The OW-shaped read models built from a ``catalog.entity`` row, and the map lookup a match log uses."""

from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from shared.repository import CatalogEntityRepository
from shared.schemas.catalog import GamemodeRead, HeroRead, MapRead


def _entity(**fields) -> SimpleNamespace:
    defaults = {
        "id": 905,
        "slug": "ilios",
        "name": "Ilios",
        "image_path": None,
        "aliases": ["Илиос"],
        "attrs": {},
        "parent_id": None,
        "parent": None,
    }
    return SimpleNamespace(**{**defaults, **fields})


def test_a_map_reads_its_mode_from_the_parent_only_when_asked() -> None:
    control = _entity(id=901, slug="control", name="Control", attrs={"description": "Capture"})
    game_map = _entity(parent_id=901, parent=control, attrs={"in_competitive": False})
    assert MapRead.from_entity(game_map).model_dump() == {
        "id": 905,
        "gamemode_id": 901,
        "name": "Ilios",
        "image_path": "",
        "in_competitive": False,
        "gamemode": None,
    }
    assert MapRead.from_entity(game_map, with_gamemode=True).gamemode.model_dump() == {
        "id": 901,
        "slug": "control",
        "name": "Control",
        "image_path": "",
        "description": "Capture",
    }


def test_a_mode_without_description_reads_none_and_a_map_defaults_to_competitive() -> None:
    assert GamemodeRead.from_entity(_entity(slug="push", name="Push")).description is None
    assert MapRead.from_entity(_entity(parent_id=1)).in_competitive is True


def test_the_map_lookup_matches_name_or_alias_of_the_map_and_of_its_mode_in_one_discipline() -> None:
    query = CatalogEntityRepository.build_map_name_or_alias_query(
        discipline="overwatch", name="Илиос", mode_name="Контроль"
    )
    sql = str(query.compile(dialect=postgresql.dialect()))
    assert "catalog.entity AS mode" in sql
    assert sql.count("@>") == 2
    assert "catalog.entity.discipline" in sql and "mode.kind" in sql


def test_a_hero_reads_its_class_as_the_hero_class_value_and_defaults_its_color() -> None:
    hero = HeroRead.from_entity(_entity(slug="ana", name="Ana", attrs={"class": "support"}))
    assert (hero.type, hero.color, hero.slug) == ("Support", "#ffffff", "ana")
