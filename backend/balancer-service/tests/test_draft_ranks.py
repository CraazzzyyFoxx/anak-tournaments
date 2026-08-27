from __future__ import annotations

import sys
from pathlib import Path

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from shared.core.enums import HeroClass  # noqa: E402
from shared.domain.roster_shape import parse_roster_slots  # noqa: E402
from shared.models.balancer.draft import DraftPlayer, DraftPlayerRole  # noqa: E402
from src.domain.draft import ranks  # noqa: E402

ROLE_SHAPE = parse_roster_slots({"tank": 1, "dps": 2, "support": 2})
FLEX_SHAPE = parse_roster_slots({"flex": 5})


def _player(*, primary="dps", rank_value=3000, role_ranks=None) -> DraftPlayer:
    # dbarch03: role_ranks is now a read-only property over the normalized
    # ``roles`` child rows, so build those rows instead of passing a JSON bag.
    return DraftPlayer(
        session_id=1,
        primary_role=primary,
        rank_value=rank_value,
        roles=[DraftPlayerRole(role=role, rank_value=rv) for role, rv in (role_ranks or {}).items()],
    )


def test_primary_role_uses_role_ranks_entry() -> None:
    p = _player(primary="dps", rank_value=4000, role_ranks={"dps": 4000, "support": 2800})
    assert ranks.role_rank(p, HeroClass.damage) == 4000


def test_off_role_uses_its_own_rank_not_primary() -> None:
    p = _player(primary="dps", rank_value=4000, role_ranks={"dps": 4000, "support": 2800})
    assert ranks.role_rank(p, HeroClass.support) == 2800


def test_falls_back_to_rank_value_when_role_missing() -> None:
    p = _player(primary="dps", rank_value=4000, role_ranks={"dps": 4000})
    assert ranks.role_rank(p, HeroClass.tank) == 4000


def test_none_role_returns_rank_value() -> None:
    p = _player(rank_value=3300, role_ranks={"support": 2800})
    assert ranks.role_rank(p, None) == 3300


def test_accepts_string_role() -> None:
    p = _player(primary="dps", rank_value=4000, role_ranks={"support": 2800})
    assert ranks.role_rank(p, "support") == 2800


def test_empty_role_ranks_falls_back() -> None:
    p = _player(primary="tank", rank_value=3500, role_ranks={})
    assert ranks.role_rank(p, HeroClass.tank) == 3500
    assert ranks.role_rank(p, HeroClass.damage) == 3500


def test_max_role_rank_is_the_best_role_not_the_primary() -> None:
    p = _player(primary="support", rank_value=2800, role_ranks={"dps": 4000, "support": 2800})
    assert ranks.max_role_rank(p) == 4000


def test_max_role_rank_counts_rank_value_when_a_role_carries_none() -> None:
    # role_rank() answers 3500 for tank, so the maximum may not be below it.
    p = _player(primary="tank", rank_value=3500, role_ranks={"support": 2800})
    assert ranks.max_role_rank(p) == 3500


def test_max_role_rank_is_none_without_any_rank() -> None:
    assert ranks.max_role_rank(_player(rank_value=None, role_ranks={})) is None


def test_slot_rank_stays_role_specific_under_role_slots() -> None:
    p = _player(primary="dps", rank_value=4000, role_ranks={"dps": 4000, "support": 2800})
    assert ranks.slot_rank(p, HeroClass.support, ROLE_SHAPE) == 2800


def test_slot_rank_ignores_the_role_under_an_all_flex_shape() -> None:
    # The shape assigns nobody a role, so the requested one cannot lower the rank.
    p = _player(primary="dps", rank_value=4000, role_ranks={"dps": 4000, "support": 2800})
    assert ranks.slot_rank(p, HeroClass.support, FLEX_SHAPE) == 4000


def test_slot_rank_without_a_role_is_rank_value_under_role_slots() -> None:
    p = _player(primary="support", rank_value=2800, role_ranks={"dps": 4000, "support": 2800})
    assert ranks.slot_rank(p, None, ROLE_SHAPE) == 2800
    assert ranks.slot_rank(p, None, FLEX_SHAPE) == 4000
