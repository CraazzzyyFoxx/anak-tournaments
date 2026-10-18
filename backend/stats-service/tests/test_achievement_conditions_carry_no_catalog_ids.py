"""Condition trees name catalog entries by slug or name, never by id (spec §14.2: ``discipline01`` checks
``achievements.rule.condition_tree`` for catalog ids). A param that took an id would need a rewrite of every stored rule
the next time the catalog's ids change, so none may exist."""

from shared.domain.achievements.registry import get_specs

_ID_PARAMS = {"hero_id", "map_id", "gamemode_id", "entity_id", "item_id", "item_ids"}


def test_no_condition_param_takes_a_catalog_id() -> None:
    specs = get_specs(discipline="overwatch")
    assert len(specs) > 10
    params = {param for spec in specs.values() for param in (*spec.required, *spec.optional)}
    assert params & _ID_PARAMS == set()
