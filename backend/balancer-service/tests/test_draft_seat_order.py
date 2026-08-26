"""What a round rule MEANS, pinned per rule.

``round_seat_order`` is the single source of truth shared by seeding
(``lifecycle.seed``), the settings resync (``lifecycle.resync_pick_order``) and
the frontend's wizard preview (``buildDraftSchedule``). It used to exist only
inline inside ``seed``, so a rule changed after seeding was previewed one way
and drafted another -- these tests are the contract that closes that.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ["DEBUG"] = "false"

from shared.core.enums import DraftFormat  # noqa: E402
from src.domain.draft.rules import (  # noqa: E402
    DYNAMIC_ROUND_RULES,
    average_seat_order,
    round_seat_order,
)


@dataclass(frozen=True)
class _Team:
    id: int
    draft_position: int


# Seed order: position 1 picks first. Ids deliberately do NOT ascend with
# position, so any ordering that leaks id order instead of seat order shows up.
SEATS = [_Team(id=70, draft_position=1), _Team(id=20, draft_position=2), _Team(id=50, draft_position=3)]
# Middle seat has the strongest captain, so rank order differs from seat order.
CAPTAIN_RANKS = {70: 3000, 20: 4000, 50: 2000}


def _order(**kwargs) -> list[int]:
    kwargs.setdefault("fmt", DraftFormat.CUSTOM)
    kwargs.setdefault("round_rules", [])
    kwargs.setdefault("round_idx", 0)
    kwargs.setdefault("captain_ranks", CAPTAIN_RANKS)
    return [team.id for team in round_seat_order(SEATS, **kwargs)]


def test_reverse_is_the_seed_order_backwards() -> None:
    # N -> 1, which is what the rule is labelled: not id order, not rank order.
    assert _order(round_rules=["reverse"]) == [50, 20, 70]


def test_linear_is_the_seed_order() -> None:
    assert _order(round_rules=["linear"]) == [70, 20, 50]


def test_weakest_first_ranks_captains_ascending() -> None:
    assert _order(round_rules=["weakest_first"]) == [50, 70, 20]


def test_strongest_first_ranks_captains_descending() -> None:
    assert _order(round_rules=["strongest_first"]) == [20, 70, 50]


def test_an_unranked_captain_counts_as_weakest() -> None:
    assert _order(round_rules=["weakest_first"], captain_ranks={70: 3000, 20: 4000}) == [50, 70, 20]


def test_a_dynamic_rule_keeps_the_seed_order_until_the_round_starts() -> None:
    for rule in DYNAMIC_ROUND_RULES:
        assert _order(round_rules=[rule]) == [70, 20, 50]


def test_a_missing_or_unknown_rule_falls_back_to_the_seed_order() -> None:
    # A hole (older client) and a rule this build does not know must not reorder.
    assert _order(round_rules=[None]) == [70, 20, 50]
    assert _order(round_rules=["from_the_future"]) == [70, 20, 50]
    assert _order(round_rules=[], round_idx=2) == [70, 20, 50]


def test_the_rule_applies_to_its_own_round() -> None:
    rules = ["linear", "reverse", "strongest_first"]
    assert _order(round_rules=rules, round_idx=0) == [70, 20, 50]
    assert _order(round_rules=rules, round_idx=1) == [50, 20, 70]
    assert _order(round_rules=rules, round_idx=2) == [20, 70, 50]


def test_snake_reverses_every_even_round_and_ignores_the_rules() -> None:
    assert _order(fmt=DraftFormat.SNAKE, round_rules=["strongest_first"], round_idx=0) == [70, 20, 50]
    assert _order(fmt=DraftFormat.SNAKE, round_rules=["strongest_first"], round_idx=1) == [50, 20, 70]
    assert _order(fmt=DraftFormat.SNAKE, round_idx=2) == [70, 20, 50]


def test_linear_format_ignores_the_rules_entirely() -> None:
    assert _order(fmt=DraftFormat.LINEAR, round_rules=["reverse"], round_idx=1) == [70, 20, 50]


class TestAverageSeatOrder:
    """``team_avg_*``: by live average, and what happens when averages tie.

    Round 2 is where this decides everything: every team holds exactly its
    captain, so equal captain ranks mean equal averages and the tie-break IS the
    round order.
    """

    def test_ascending_puts_the_lowest_average_first(self) -> None:
        order = average_seat_order(SEATS, averages={70: 3000.0, 20: 2000.0, 50: 2500.0}, descending=False)

        assert [team.id for team in order] == [20, 50, 70]

    def test_descending_puts_the_highest_average_first(self) -> None:
        order = average_seat_order(SEATS, averages={70: 3000.0, 20: 2000.0, 50: 2500.0}, descending=True)

        assert [team.id for team in order] == [70, 50, 20]

    def test_equal_averages_fall_back_to_the_seed_order_in_both_directions(self) -> None:
        # The regression this pins: `reverse=True` flipped the whole sort key, so
        # tied teams came out 3 -> 1 under desc and 1 -> 3 under asc. The seed
        # order is the answer either way, as it is for equal captain ranks.
        tied = {70: 2800.0, 20: 2800.0, 50: 2800.0}

        assert [team.draft_position for team in average_seat_order(SEATS, averages=tied, descending=False)] == [1, 2, 3]
        assert [team.draft_position for team in average_seat_order(SEATS, averages=tied, descending=True)] == [1, 2, 3]

    def test_a_partial_tie_breaks_by_seed_within_the_tied_group_only(self) -> None:
        averages = {70: 2800.0, 20: 2800.0, 50: 3500.0}

        assert [t.id for t in average_seat_order(SEATS, averages=averages, descending=False)] == [70, 20, 50]
        assert [t.id for t in average_seat_order(SEATS, averages=averages, descending=True)] == [50, 70, 20]

    def test_a_team_without_an_average_sorts_as_zero(self) -> None:
        averages = {70: 2800.0, 20: 2800.0}

        assert [t.id for t in average_seat_order(SEATS, averages=averages, descending=False)] == [50, 70, 20]
        assert [t.id for t in average_seat_order(SEATS, averages=averages, descending=True)] == [70, 20, 50]

    def test_the_input_list_is_never_mutated(self) -> None:
        before = list(SEATS)
        average_seat_order(SEATS, averages={70: 1.0}, descending=True)

        assert SEATS == before


def test_the_input_list_is_never_mutated() -> None:
    before = list(SEATS)
    _order(round_rules=["reverse"])
    _order(round_rules=["strongest_first"])

    assert SEATS == before
