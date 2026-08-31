"""Pure-mapping tests for the mix_balancer backend connector.

These exercise only the uuid/priority/metrics helpers, which need no native
``balance_engine`` extension -- they run on any platform (including this
Windows dev box, where the Linux-only compiled engine cannot be installed).
``MixBalancerBackend.solve()`` itself (the part that actually calls into the
compiled engine) is intentionally NOT covered here; see the module docstring
in ``domain/balancer/backends/mix_balancer.py``.
"""

from __future__ import annotations

import os
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ["DEBUG"] = "false"

from src.domain.balancer.backends.mix_balancer import (  # noqa: E402
    _MAX_PRIORITY,
    build_metrics,
    member_uuid,
    priority_for_role,
    role_uuid,
)
from src.domain.balancer.entities import Player  # noqa: E402


def _player(**kwargs) -> Player:
    defaults = {
        "name": "p",
        "ratings": {"Tank": 2500, "Damage": 2000},
        "preferences": ["Tank", "Damage"],
        "uuid": "player-1",
        "mask": {"Tank": 1, "Damage": 2, "Support": 2},
    }
    defaults.update(kwargs)
    return Player(**defaults)


class RoleAndMemberUuidTests(unittest.TestCase):
    def test_role_uuid_is_deterministic(self) -> None:
        self.assertEqual(role_uuid("Tank"), role_uuid("Tank"))

    def test_role_uuid_differs_per_role(self) -> None:
        self.assertNotEqual(role_uuid("Tank"), role_uuid("Damage"))

    def test_role_uuid_is_a_real_uuid(self) -> None:
        self.assertIsInstance(role_uuid("Tank"), uuid.UUID)

    def test_member_uuid_is_deterministic_and_distinct_from_role_uuid(self) -> None:
        self.assertEqual(member_uuid("player-1"), member_uuid("player-1"))
        # Distinct namespaces: a role code and a player uuid that happen to be
        # the same string must not collide.
        self.assertNotEqual(role_uuid("player-1"), member_uuid("player-1"))

    def test_member_uuid_differs_per_player(self) -> None:
        self.assertNotEqual(member_uuid("player-1"), member_uuid("player-2"))


class PriorityForRoleTests(unittest.TestCase):
    def test_most_preferred_role_gets_max_priority(self) -> None:
        player = _player(preferences=["Tank", "Damage"])
        self.assertEqual(priority_for_role(player, "Tank"), _MAX_PRIORITY)

    def test_later_preference_gets_lower_priority(self) -> None:
        player = _player(preferences=["Tank", "Damage"])
        self.assertEqual(priority_for_role(player, "Damage"), _MAX_PRIORITY - 1)

    def test_priority_floors_at_one_past_the_ceiling(self) -> None:
        player = _player(
            ratings={"Tank": 1, "Damage": 1, "Support": 1, "Flex": 1},
            preferences=["Tank", "Damage", "Support", "Flex"],
            mask={"Tank": 1, "Damage": 1, "Support": 1, "Flex": 1},
        )
        # 4th preference would be max_priority(3) - 3 = 0; floored at 1.
        self.assertEqual(priority_for_role(player, "Flex"), 1)

    def test_flex_player_gets_max_priority_for_every_playable_role(self) -> None:
        player = _player(is_flex=True, preferences=["Tank", "Damage"])
        self.assertEqual(priority_for_role(player, "Tank"), _MAX_PRIORITY)
        self.assertEqual(priority_for_role(player, "Damage"), _MAX_PRIORITY)

    def test_role_outside_preferences_defaults_to_lowest_priority(self) -> None:
        player = _player(ratings={"Tank": 2500}, preferences=["Tank"])
        self.assertEqual(priority_for_role(player, "Support"), 1)


class BuildMetricsTests(unittest.TestCase):
    def test_maps_and_prefixes_every_field(self) -> None:
        quality = SimpleNamespace(fairness=1.5, uniformity=2.5, role_fairness=3.5, role_points=4.5, total=12.0)
        metrics = build_metrics(quality)
        self.assertEqual(
            metrics.to_dict(),
            {
                "mix_balancer_fairness": 1.5,
                "mix_balancer_uniformity": 2.5,
                "mix_balancer_role_fairness": 3.5,
                "mix_balancer_role_points": 4.5,
                "mix_balancer_quality_total": 12.0,
            },
        )

    def test_coerces_to_float(self) -> None:
        quality = SimpleNamespace(fairness=1, uniformity=2, role_fairness=3, role_points=4, total=10)
        metrics = build_metrics(quality)
        self.assertTrue(all(isinstance(v, float) for v in metrics.to_dict().values()))

    def test_other_backend_fields_stay_unset(self) -> None:
        quality = SimpleNamespace(fairness=1.0, uniformity=1.0, role_fairness=1.0, role_points=1.0, total=4.0)
        metrics = build_metrics(quality)
        self.assertIsNone(metrics.balance_objective)
        self.assertIsNone(metrics.composite_score)


class MixBalanceFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_falls_back_when_native_engine_is_missing(self) -> None:
        from src.services.balancer.solver import run_mix_balance

        with patch("src.services.balancer.solver.balance_teams") as balance:
            balance.side_effect = [
                RuntimeError("mix_balancer requires the 'mix-balancer' package"),
                [{"ok": True}],
            ]
            result = await run_mix_balance({}, None, None, None)
        self.assertEqual(result, {"variants": [{"ok": True}]})
        self.assertEqual("mix_balancer", balance.call_args_list[0].kwargs["algorithm"])
        self.assertEqual("tournament_balancer", balance.call_args_list[1].kwargs["algorithm"])


if __name__ == "__main__":
    unittest.main()
