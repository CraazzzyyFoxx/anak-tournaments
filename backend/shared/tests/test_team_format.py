"""Team format (§8.3, D33): the slot projection, the roster check and the write-time check."""

from __future__ import annotations

from dataclasses import replace

import pytest

from shared.disciplines import DISCIPLINES
from shared.domain.roles import DimensionNode, Ontology, RoleNode
from shared.domain.roster_shape import RosterShape
from shared.domain.team_format import (
    FormatDimension,
    FormatRule,
    TeamFormat,
    TeamFormatError,
    check_team_format,
    export_violations,
    slot_shape,
    validate_roster,
)


def _module_ontology(code: str, *, sub_roles: tuple[tuple[str, str], ...] = ()) -> Ontology:
    """The module's declaration as the projection loads it; ``sub_roles`` are ``(parent, code)`` of workspace 7."""
    spec = DISCIPLINES[code]
    dimensions: list[DimensionNode] = []
    roles: list[RoleNode] = []
    next_id = 100
    for index, dimension in enumerate(spec.dimensions, start=1):
        dimensions.append(
            DimensionNode(index, dimension.code, dimension.name, dimension.selection_mode, dimension.rated)
        )
        for order, role in enumerate(dimension.roles):
            next_id += 1
            roles.append(RoleNode(next_id, index, dimension.code, role.code, role.name, sort_order=order))
    rated = next(dimension for dimension in dimensions if dimension.rated)
    parents = {role.code: role for role in roles if role.dimension == rated.code}
    for parent, sub_role in sub_roles:
        next_id += 1
        roles.append(
            RoleNode(
                next_id, rated.id, rated.code, sub_role, sub_role.title(), parent_id=parents[parent].id, workspace_id=7
            )
        )
    return Ontology(code, dimensions, roles)


def _members(ontology: Ontology, *codes: str | None) -> list[list[RoleNode]]:
    """One member per code: their single leaf role on the rated dimension; ``None`` holds no role."""
    rated = ontology.rated.code
    return [[] if code is None else [ontology.node(rated, code)] for code in codes]


OW_5V5 = TeamFormat.from_preset("overwatch", DISCIPLINES["overwatch"].preset())


def test_the_overwatch_preset_projects_to_today_s_1_2_2_slots() -> None:
    assert slot_shape(OW_5V5, _module_ontology("overwatch")) == RosterShape(
        entries=(("tank", 1), ("damage", 2), ("support", 2))
    )


def test_lol_presets_project_to_positions_or_to_open_slots() -> None:
    ontology = _module_ontology("lol")
    positions, roleless = (TeamFormat.from_preset("lol", preset) for preset in DISCIPLINES["lol"].team_format_presets)
    assert slot_shape(positions, ontology).slots == {"top": 1, "jungle": 1, "mid": 1, "bot": 1, "support": 1}
    assert slot_shape(roleless, ontology).slots == {"flex": 5}


def test_a_minimum_without_a_maximum_takes_its_slots_and_leaves_the_rest_open() -> None:
    one_tank = TeamFormat(
        "overwatch",
        "1 tank + open",
        6,
        6,
        dimensions=(FormatDimension("player_role", "enforced"),),
        rules=(FormatRule("player_role", "tank", hard_min=1),),
    )
    assert slot_shape(one_tank, _module_ontology("overwatch")).slots == {"tank": 1, "flex": 5}


def test_an_informational_rated_dimension_makes_only_open_slots() -> None:
    informational = replace(OW_5V5, dimensions=(FormatDimension("player_role", "informational"),))
    assert slot_shape(informational, _module_ontology("overwatch")).slots == {"flex": 5}


def test_role_slots_beyond_the_starting_line_up_are_refused() -> None:
    with pytest.raises(TeamFormatError) as exc_info:
        slot_shape(replace(OW_5V5, starter_min=4, starter_max=4), _module_ontology("overwatch"))
    assert exc_info.value.code == "team_format_slots_exceed_starters"


def test_a_1_2_2_roster_passes_the_overwatch_preset() -> None:
    ontology = _module_ontology("overwatch")
    verdict = validate_roster(OW_5V5, ontology, _members(ontology, "tank", "damage", "damage", "support", "support"))
    assert verdict.ok
    assert verdict.advisories == ()


def test_a_second_tank_breaks_the_enforced_quotas() -> None:
    ontology = _module_ontology("overwatch")
    verdict = validate_roster(OW_5V5, ontology, _members(ontology, "tank", "tank", "damage", "support", "support"))
    assert [violation.code for violation in verdict.violations] == ["role_above_hard_max", "role_below_hard_min"]


def test_a_sub_role_counts_toward_its_parent_only_with_include_descendants() -> None:
    ontology = _module_ontology("overwatch", sub_roles=(("damage", "hitscan"),))
    roster = _members(ontology, "tank", "hitscan", "damage", "support", "support")
    assert validate_roster(OW_5V5, ontology, roster).ok
    strict = replace(OW_5V5, rules=tuple(replace(rule, include_descendants=False) for rule in OW_5V5.rules))
    assert [violation.code for violation in validate_roster(strict, ontology, roster).violations] == [
        "role_below_hard_min"
    ]


def test_two_roles_on_a_single_dimension_break_the_assignment_rule() -> None:
    ontology = _module_ontology("overwatch")
    roster = _members(ontology, "tank", "damage", "damage", "support", "support")
    roster[0] = [ontology.node("player_role", "tank"), ontology.node("player_role", "support")]
    assert [violation.code for violation in validate_roster(OW_5V5, ontology, roster).violations] == [
        "assignments_out_of_range",
        "role_above_hard_max",
    ]


@pytest.mark.parametrize("substitute", [False, True])
@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("informational", ["unknown_role"]),
        ("preference", ["unknown_role"]),
        ("enforced", ["unknown_role"]),
        ("off", []),
    ],
)
def test_unknown_assignments_are_rejected_only_on_active_dimensions(
    mode: str, expected: list[str], substitute: bool
) -> None:
    ontology = _module_ontology("overwatch")
    team_format = replace(
        OW_5V5,
        substitute_max=1,
        dimensions=(FormatDimension("player_role", mode),),
        rules=(),
    )
    roster = _members(ontology, "tank", "damage", "damage", "support", "support")
    unknown = replace(ontology.node("player_role", "tank"), id=999)
    substitutes = [[unknown]] if substitute else []
    if not substitute:
        # The invalid assignment must not count as a second role on a single dimension.
        roster[0].append(unknown)
    verdict = validate_roster(team_format, ontology, roster, substitutes)
    assert [violation.code for violation in verdict.violations] == expected
    assert verdict.advisories == ()


@pytest.mark.parametrize("change", [{"dimension_id": 99}, {"id": 999, "dimension_id": 99}])
def test_mismatched_assignments_do_not_count_toward_cardinality_or_quotas(change: dict[str, int]) -> None:
    module = _module_ontology("overwatch")
    ontology = Ontology(
        module.discipline,
        [*module.dimensions.values(), DimensionNode(99, "tactics", "Tactics", "single", False)],
        [*module.roles("player_role"), RoleNode(999, 99, "tactics", "caller", "Caller")],
    )
    roster = _members(ontology, "tank", "damage", "damage", "support", "support")
    roster[0] = [replace(roster[0][0], **change)]
    team_format = replace(
        OW_5V5,
        dimensions=(FormatDimension("player_role", "enforced", player_min_assignments=1),),
    )
    verdict = validate_roster(team_format, ontology, roster)
    assert [violation.code for violation in verdict.violations] == [
        "role_dimension_mismatch",
        "assignments_out_of_range",
        "role_below_hard_min",
    ]
    assert verdict.advisories == ()


def test_recommendations_never_reject() -> None:
    ontology = _module_ontology("overwatch", sub_roles=(("damage", "hitscan"),))
    advised = replace(OW_5V5, rules=(*OW_5V5.rules, FormatRule("player_role", "hitscan", recommended_min=1)))
    verdict = validate_roster(advised, ontology, _members(ontology, "tank", "damage", "damage", "support", "support"))
    assert verdict.ok
    assert [advisory.code for advisory in verdict.advisories] == ["role_below_recommended_min"]


def test_cardinality_and_hard_rules_stay_errors_on_a_preference_dimension() -> None:
    # §8.3 steps 3-5: multiplicity and hard quotas reject on every active dimension; only recommendations are soft.
    ontology = _module_ontology("overwatch")
    preference = replace(OW_5V5, dimensions=(FormatDimension("player_role", "preference"),))
    verdict = validate_roster(preference, ontology, _members(ontology, "tank", "tank", "damage", "support", "support"))
    assert not verdict.ok
    assert [violation.code for violation in verdict.violations] == ["role_above_hard_max", "role_below_hard_min"]
    off = replace(OW_5V5, dimensions=(FormatDimension("player_role", "off"),))
    assert validate_roster(off, ontology, _members(ontology, "tank", "tank", "damage", "support", "support")).ok


def test_a_short_line_up_is_refused_before_the_quotas() -> None:
    ontology = _module_ontology("overwatch")
    verdict = validate_roster(OW_5V5, ontology, _members(ontology, None, None, None, None))
    assert verdict.violations[0].code == "starters_out_of_range"


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"starter_min": 6}, "team_format_sizes"),
        ({"rules": (FormatRule("player_role", "healer", hard_min=1),)}, "team_format_unknown_role"),
        ({"rules": (FormatRule("position", "top", hard_min=1),)}, "team_format_rule_dimension"),
        ({"rules": (FormatRule("player_role", "tank", hard_min=2, hard_max=1),)}, "team_format_rule_range"),
        ({"starter_min": 4, "starter_max": 4}, "team_format_slots_exceed_starters"),
    ],
)
def test_a_format_that_cannot_be_stored_names_why(change: dict, code: str) -> None:
    with pytest.raises(TeamFormatError) as exc_info:
        check_team_format(replace(OW_5V5, **change), _module_ontology("overwatch"))
    assert exc_info.value.code == code


def test_every_module_preset_is_storable() -> None:
    for code, spec in DISCIPLINES.items():
        for preset in spec.team_format_presets:
            check_team_format(TeamFormat.from_preset(code, preset), _module_ontology(code))


def test_an_exported_team_is_checked_on_every_assignment_of_its_starters() -> None:
    ontology = _module_ontology("overwatch", sub_roles=(("damage", "hitscan"),))
    one_hitscan = replace(OW_5V5, rules=(*OW_5V5.rules, FormatRule("player_role", "hitscan", hard_max=1)))
    node = lambda code: ontology.node("player_role", code)  # noqa: E731
    fine = [[node("tank")], [node("hitscan")], [node("damage")], [node("support")], [node("support")]]
    assert export_violations(one_hitscan, ontology, fine) == ()
    two = [[node("tank")], [node("hitscan")], [node("hitscan")], [node("support")], [node("support")]]
    assert export_violations(one_hitscan, ontology, two) == ("role_above_hard_max",)
    assert export_violations(OW_5V5, ontology, [[node("tank")], [], [], [], []]) == (
        "role_below_hard_min",
        "role_below_hard_min",
    )
    assert "assignments_out_of_range" in export_violations(
        OW_5V5,
        ontology,
        [[node("tank"), node("support")], [node("damage")], [node("damage")], [node("support")], [node("support")]],
    )
