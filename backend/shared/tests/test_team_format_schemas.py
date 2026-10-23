"""The wire of a team format and of a role (D92)."""

from __future__ import annotations

from shared.disciplines import DISCIPLINES
from shared.domain.roles import DimensionNode, Ontology, RoleNode
from shared.domain.team_format import TeamFormat
from shared.schemas.role import RoleRef
from shared.schemas.team_format import TeamFormatRead, TeamFormatWrite


def _ontology() -> Ontology:
    return Ontology(
        "overwatch",
        [DimensionNode(1, "player_role", "Role", "single", True)],
        [
            RoleNode(10, 1, "player_role", "tank", "Tank", sort_order=0),
            RoleNode(11, 1, "player_role", "damage", "Damage", sort_order=1),
            RoleNode(12, 1, "player_role", "support", "Support", sort_order=2),
            RoleNode(20, 1, "player_role", "hitscan", "Hitscan", parent_id=11, workspace_id=7),
        ],
    )


def test_a_preset_round_trips_through_the_wire() -> None:
    preset = TeamFormat.from_preset("overwatch", DISCIPLINES["overwatch"].preset())
    read = TeamFormatRead.from_domain(preset, source="preset", ontology=_ontology())
    assert read.roster_shape.slots == {"tank": 1, "damage": 2, "support": 2}
    assert (read.roster_shape.dimension, read.roster_shape.source) == ("player_role", "preset")
    assert read.rules[0].role == RoleRef(dimension="player_role", role="tank")
    assert (
        TeamFormatWrite.model_validate(read.model_dump(exclude={"discipline", "source", "roster_shape"})).to_domain(
            "overwatch"
        )
        == preset
    )


def test_a_role_ref_names_the_leaf_and_derives_its_parent() -> None:
    ontology = _ontology()
    assert RoleRef.of("player_role", "damage", "hitscan") == RoleRef(
        dimension="player_role", role="hitscan", parent="damage"
    )
    assert RoleRef.of("player_role", "tank") == RoleRef(dimension="player_role", role="tank")
    assert RoleRef.of("player_role", None) is None
    assert RoleRef.of_node(ontology, ontology.node("player_role", "hitscan")).parent == "damage"
