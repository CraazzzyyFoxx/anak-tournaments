"""Slot-vocabulary rules for pick selection.

The draft no longer derives per-role targets from a scalar team size: it fills the
tournament's ``RosterShape``, where a ``flex`` slot accepts anybody. These tests
pin the decision layer (``resolve_pick_slot``, ``_team_slot_counts``,
``_role_openings``) plus the option-level ``slot_filled`` reason, all of which are
pure and therefore run without Postgres or Redis.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from shared.core.enums import DraftPickStatus, DraftPlayerStatus, DraftRole  # noqa: E402
from shared.domain.roster_shape import parse_roster_slots  # noqa: E402
from shared.models.balancer.draft import DraftPick, DraftPlayer, DraftPlayerRole  # noqa: E402
from src.services.draft import feasibility, selection  # noqa: E402


def _shape(slots: dict[str, int]):
    return parse_roster_slots(slots)


def _code(exc: Exception) -> str:
    return exc.detail[0]["code"]


def _player(
    player_id: int,
    primary: DraftRole,
    *secondary: DraftRole,
    is_flex: bool = False,
    status: DraftPlayerStatus = DraftPlayerStatus.AVAILABLE,
    team_id: int | None = None,
) -> DraftPlayer:
    return DraftPlayer(
        id=player_id,
        session_id=1,
        primary_role=primary.value,
        status=status.value,
        is_flex=is_flex,
        drafted_by_team_id=team_id,
        roles=[
            DraftPlayerRole(role=primary.value, priority=0),
            *(
                DraftPlayerRole(role=role.value, is_secondary=True, priority=index + 1)
                for index, role in enumerate(secondary)
            ),
        ],
    )


def _pick(pick_id: int, *, player_id: int, team_id: int, target_role: DraftRole | None) -> DraftPick:
    return DraftPick(
        id=pick_id,
        session_id=1,
        overall_no=pick_id,
        round_no=1,
        pick_in_round=pick_id,
        draft_team_id=team_id,
        status=DraftPickStatus.COMPLETED.value,
        picked_player_id=player_id,
        target_role=target_role.value if target_role else None,
    )


def _eligible(player_id: int, *roles: DraftRole):
    return feasibility.EligiblePlayer(player_id=player_id, playable_roles=frozenset(roles))


def test_a_second_tank_is_legal_while_a_flex_slot_is_open() -> None:
    shape = _shape({"tank": 1, "flex": 5})
    picked_tank = _player(
        1,
        DraftRole.TANK,
        status=DraftPlayerStatus.PICKED,
        team_id=10,
    )
    counts = selection._team_slot_counts(
        (picked_tank,),
        (_pick(1, player_id=1, team_id=10, target_role=DraftRole.TANK),),
        10,
        shape,
    )

    assert counts["tank"] == 1
    # The role slot is full, but five flex slots still accept a tank.
    assert selection._role_openings(shape, counts)[DraftRole.TANK] == 5

    decision = selection.resolve_pick_slot(shape, counts, _player(2, DraftRole.TANK), DraftRole.TANK)

    assert decision.role is DraftRole.TANK
    assert decision.recorded_role == "tank"


def test_slot_filled_needs_both_the_role_and_the_flex_capacity_gone() -> None:
    shape = _shape({"tank": 1, "dps": 2, "flex": 1})
    picked = (
        _player(1, DraftRole.TANK, status=DraftPlayerStatus.PICKED, team_id=10),
        _player(2, DraftRole.DPS, status=DraftPlayerStatus.PICKED, team_id=10),
        _player(3, DraftRole.DPS, status=DraftPlayerStatus.PICKED, team_id=10),
    )
    picks = tuple(
        _pick(index + 1, player_id=player.id, team_id=10, target_role=DraftRole(player.primary_role))
        for index, player in enumerate(picked)
    )
    counts = selection._team_slot_counts(picked, picks, 10, shape)

    # Tank and DPS role slots are exhausted, the single flex slot is not.
    assert counts == {"tank": 1, "dps": 2, "flex": 0}
    assert selection._role_openings(shape, counts)[DraftRole.TANK] == 1
    decision = selection.resolve_pick_slot(shape, counts, _player(4, DraftRole.TANK), DraftRole.TANK)
    assert decision.role is DraftRole.TANK

    # Spend the flex slot too: now nothing is left for a fourth tank.
    counts_with_flex_used = dict(counts, flex=1)
    assert selection._role_openings(shape, counts_with_flex_used)[DraftRole.TANK] == 0
    with pytest.raises(Exception) as exc_info:
        selection.resolve_pick_slot(
            shape, counts_with_flex_used, _player(5, DraftRole.TANK), DraftRole.TANK
        )

    assert _code(exc_info.value) == "slot_filled"


def test_pick_options_report_slot_filled_only_without_any_remaining_capacity() -> None:
    with_flex = feasibility.evaluate_pick_options(
        team_id=10,
        team_ids=(10,),
        slot_targets={"tank": 1, "flex": 1},
        players=(_eligible(1, DraftRole.TANK),),
        assignments=(feasibility.DraftAssignment(player_id=99, team_id=10, slot_code="tank"),),
    )
    without_flex = feasibility.evaluate_pick_options(
        team_id=10,
        team_ids=(10,),
        slot_targets={"tank": 1, "dps": 1},
        players=(_eligible(1, DraftRole.TANK),),
        assignments=(feasibility.DraftAssignment(player_id=99, team_id=10, slot_code="tank"),),
    )

    flex_option = next(option for option in with_flex if option.role is DraftRole.TANK)
    assert flex_option.reason_code != "slot_filled"
    assert flex_option.is_safe is True

    blocked = next(option for option in without_flex if option.role is DraftRole.TANK)
    assert blocked.is_safe is False
    assert blocked.reason_code == "slot_filled"


def test_a_role_less_roster_ignores_the_requested_target_role() -> None:
    shape = _shape({"flex": 6})
    counts = selection._team_slot_counts((), (), 10, shape)

    # The player cannot play tank at all, yet the request must not be rejected:
    # a flex-only roster has no role to validate against.
    decision = selection.resolve_pick_slot(shape, counts, _player(1, DraftRole.DPS), DraftRole.TANK)

    assert shape.has_role_slots is False
    assert decision.role is DraftRole.DPS
    assert decision.recorded_role is None


def test_a_role_slot_roster_keeps_the_existing_target_role_rules() -> None:
    shape = _shape({"tank": 1, "dps": 2, "support": 2})
    counts = selection._team_slot_counts((), (), 10, shape)

    decision = selection.resolve_pick_slot(
        shape, counts, _player(1, DraftRole.DPS, DraftRole.TANK), DraftRole.TANK
    )
    assert decision.role is DraftRole.TANK
    assert decision.recorded_role == "tank"

    with pytest.raises(Exception) as illegal:
        selection.resolve_pick_slot(shape, counts, _player(2, DraftRole.DPS), DraftRole.TANK)
    assert _code(illegal.value) == "illegal_role"

    with pytest.raises(Exception) as filled:
        selection.resolve_pick_slot(
            shape, dict(counts, tank=1), _player(3, DraftRole.TANK), DraftRole.TANK
        )
    assert _code(filled.value) == "slot_filled"


def test_team_slot_counts_fill_role_slots_first_and_flex_with_the_remainder() -> None:
    shape = _shape({"tank": 1, "dps": 1, "flex": 2})
    captain = _player(1, DraftRole.SUPPORT, status=DraftPlayerStatus.PICKED, team_id=10)
    off_role = _player(2, DraftRole.SUPPORT, DraftRole.DPS, status=DraftPlayerStatus.PICKED, team_id=10)
    tank = _player(3, DraftRole.TANK, status=DraftPlayerStatus.PICKED, team_id=10)
    other_team = _player(4, DraftRole.TANK, status=DraftPlayerStatus.PICKED, team_id=20)
    available = _player(5, DraftRole.TANK)
    picks = (
        # The frozen target_role wins over primary_role.
        _pick(2, player_id=2, team_id=10, target_role=DraftRole.DPS),
        _pick(3, player_id=3, team_id=10, target_role=None),
        _pick(4, player_id=4, team_id=20, target_role=DraftRole.TANK),
    )
    players = (captain, off_role, tank, other_team, available)

    counts = selection._team_slot_counts(players, picks, 10, shape)

    # Three picked players on team 10: tank and dps role slots take one each, and
    # the support captain has no role slot to land in, so flex absorbs them.
    assert counts == {"tank": 1, "dps": 1, "flex": 1}
    assert selection._role_openings(shape, counts) == {
        DraftRole.TANK: 1,
        DraftRole.DPS: 1,
        DraftRole.SUPPORT: 1,
    }


def test_an_overfilled_role_spills_into_flex_instead_of_inflating_the_role_count() -> None:
    shape = _shape({"tank": 1, "flex": 2})
    picked = tuple(
        _player(index, DraftRole.TANK, status=DraftPlayerStatus.PICKED, team_id=10)
        for index in (1, 2, 3)
    )
    picks = tuple(
        _pick(player.id, player_id=player.id, team_id=10, target_role=DraftRole.TANK)
        for player in picked
    )

    counts = selection._team_slot_counts(picked, picks, 10, shape)

    assert counts == {"tank": 1, "flex": 2}
    assert selection._role_openings(shape, counts) == dict.fromkeys(DraftRole, 0)
