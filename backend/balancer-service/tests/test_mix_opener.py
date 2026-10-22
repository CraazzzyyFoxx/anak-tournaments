"""Who bans first in a mix match (spec §8.3)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
for candidate in (str(REPO_BACKEND_ROOT), str(REPO_BACKEND_ROOT / "balancer-service")):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from src.domain.mix_opener import ban_opener  # noqa: E402

STRONG = [(1, 3000), (2, 2800)]
WEAK = [(3, 2400), (4, 2200)]


def test_the_weaker_team_opens() -> None:
    assert ban_opener([STRONG, WEAK], None) == 1
    assert ban_opener([WEAK, STRONG], None) == 0


def test_an_even_split_opens_with_the_first_team() -> None:
    assert ban_opener([[(1, 2500)], [(2, 2500)]], None) == 0


def test_last_times_loser_opens_when_the_same_teams_meet_again() -> None:
    # Slot 1 was the weak team and won; the strong team lost, so it opens despite its rating.
    previous = [(frozenset({3, 4}), 1.0), (frozenset({1, 2}), 0.0)]
    assert ban_opener([STRONG, WEAK], previous) == 0


def test_a_draw_or_another_pairing_falls_back_to_the_rating() -> None:
    assert ban_opener([STRONG, WEAK], [(frozenset({3, 4}), 0.0), (frozenset({1, 2}), 0.0)]) == 1
    assert ban_opener([STRONG, WEAK], [(frozenset({1, 3}), 1.0), (frozenset({2, 4}), 0.0)]) == 1
