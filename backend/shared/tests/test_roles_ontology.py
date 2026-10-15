"""The pure role ontology (D31, D34, D86): code <-> id, parents, subtrees."""

from __future__ import annotations

import pytest

from shared.domain.roles import DimensionNode, Ontology, RoleNode, UnknownRole


def _ontology() -> Ontology:
    return Ontology(
        "overwatch",
        [DimensionNode(1, "player_role", "Role", "single", True)],
        [
            RoleNode(10, 1, "player_role", "tank", "Tank", sort_order=0),
            RoleNode(12, 1, "player_role", "support", "Support", sort_order=2),
            RoleNode(11, 1, "player_role", "damage", "Damage", sort_order=1),
            RoleNode(20, 1, "player_role", "hitscan", "Hitscan", parent_id=11, workspace_id=7),
        ],
    )


def test_a_role_resolves_by_code_and_by_id() -> None:
    ontology = _ontology()
    assert ontology.node("player_role", "hitscan").id == 20
    assert ontology.by_id(11).code == "damage"


def test_an_unknown_role_is_a_value_error_naming_it() -> None:
    assert issubclass(UnknownRole, ValueError)
    with pytest.raises(UnknownRole, match="'healer'"):
        _ontology().node("player_role", "healer")


def test_a_sub_role_counts_as_its_parent_and_sits_in_its_subtree() -> None:
    ontology = _ontology()
    hitscan, damage = ontology.node("player_role", "hitscan"), ontology.node("player_role", "damage")
    assert ontology.root(hitscan) == damage
    assert ontology.parent(hitscan) == damage
    assert ontology.subtree(damage) == frozenset({11, 20})
    assert ontology.subtree(hitscan) == frozenset({20})


def test_roots_are_the_module_roles_in_display_order() -> None:
    assert [role.code for role in _ontology().roots("player_role")] == ["tank", "damage", "support"]


def test_the_rated_dimension_is_the_one_flagged() -> None:
    assert _ontology().rated.code == "player_role"
