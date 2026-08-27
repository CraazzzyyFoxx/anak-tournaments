"""Rank resolution for a registered team's members.

`Player.rank` is NOT NULL but `BalancerRegistrationRole.rank_value` is nullable, so
this function decides what a registered member's rank *is*. Two behaviours are
borrowed rather than invented and are pinned as such: the "no rank recorded -> 0"
answer from `registration/export.py`, and the role-vs-flex rule from
`draft/ranks.py`. Drifting from either would make the same player rank differently
depending on which path materialized their team.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import TestCase

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from shared.domain.roster_shape import parse_roster_slots  # noqa: E402
from shared.services.team_export.registered import registration_slot_rank  # noqa: E402

ROLE_SHAPE = parse_roster_slots({"tank": 1, "dps": 2, "support": 2})
FLEX_SHAPE = parse_roster_slots({"flex": 6})
MIXED_SHAPE = parse_roster_slots({"tank": 1, "flex": 4})


class RoleShapeRankTests(TestCase):
    def test_the_slots_own_role_rank_wins(self) -> None:
        rank = registration_slot_rank(
            {"tank": 3000, "dps": 2000},
            "tank",
            ROLE_SHAPE,
            primary_rank=2000,
        )
        self.assertEqual(3000, rank)

    def test_a_role_without_its_own_rank_falls_back_to_primary(self) -> None:
        """Mirrors `role_rank`, whose fallback is the primary-role default."""
        rank = registration_slot_rank({"dps": 2500}, "support", ROLE_SHAPE, primary_rank=2500)
        self.assertEqual(2500, rank)

    def test_a_flex_slot_on_a_role_shape_uses_the_primary_rank(self) -> None:
        """A flex slot names no role, which is `role_rank(player, None)` — the
        primary default, not the maximum."""
        rank = registration_slot_rank(
            {"tank": 4000, "support": 1000},
            "flex",
            MIXED_SHAPE,
            primary_rank=1000,
        )
        self.assertEqual(1000, rank)

    def test_no_ranks_at_all_is_zero_not_an_error(self) -> None:
        """Tournaments that never collect ranks must still be able to export;
        raising here would make the whole feature unusable for them."""
        self.assertEqual(0, registration_slot_rank({}, "tank", ROLE_SHAPE, primary_rank=None))

    def test_a_missing_primary_falls_back_to_the_best_recorded_rank(self) -> None:
        """Better than 0: the member demonstrably has a rank, just not on the slot
        they were placed in."""
        self.assertEqual(3300, registration_slot_rank({"dps": 3300}, "support", ROLE_SHAPE, primary_rank=None))


class RoleLessShapeRankTests(TestCase):
    def test_a_flex_roster_takes_the_best_rank(self) -> None:
        """Mirrors `max_role_rank`: with no role for rank to be a function of,
        anything lower would understate a rank the member has on a playable role."""
        rank = registration_slot_rank(
            {"tank": 1500, "dps": 3800, "support": 2200},
            "flex",
            FLEX_SHAPE,
            primary_rank=1500,
        )
        self.assertEqual(3800, rank)

    def test_the_primary_rank_joins_the_candidates_rather_than_only_falling_back(self) -> None:
        """`max_role_rank` includes `rank_value` among the candidates, because it is
        what `role_rank` answers for any role missing from the catalogue."""
        self.assertEqual(4200, registration_slot_rank({"dps": 2000}, "flex", FLEX_SHAPE, primary_rank=4200))

    def test_an_empty_flex_roster_member_is_zero(self) -> None:
        self.assertEqual(0, registration_slot_rank({}, "flex", FLEX_SHAPE, primary_rank=None))

    def test_the_slot_code_is_irrelevant_on_a_role_less_roster(self) -> None:
        """Guards against a future refactor reintroducing a role lookup here: on an
        all-flex shape there is no role slot to look up."""
        ranks = {"tank": 1000, "dps": 3000}
        for slot in ("flex", None, "tank"):
            with self.subTest(slot=slot):
                self.assertEqual(3000, registration_slot_rank(ranks, slot, FLEX_SHAPE, primary_rank=1000))


class DivergenceGuardTests(TestCase):
    """The two rules above exist elsewhere; these pin that they still agree."""

    def test_zero_is_the_same_sentinel_the_balancer_export_uses(self) -> None:
        """`registration/export.py::build_class` emits `"rank": 0` for a role with
        no rank. A different sentinel here would rank the same player differently in
        the balancer pool and on the exported team — read from the other file's
        source, because the two live in different services and cannot import each
        other."""
        source = (BACKEND_ROOT / "tournament-service" / "src" / "services" / "registration" / "export.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('"rank": int(role.rank_value) if role and role.rank_value is not None else 0', source)

    def test_the_role_less_rule_is_a_maximum_not_a_primary(self) -> None:
        """The one-line summary of `slot_rank`: role slots keep rank role-specific,
        a role-less roster makes it the maximum. Inverting these is the plausible
        mistake, so both directions are asserted together."""
        ranks = {"tank": 1000, "dps": 3000}
        self.assertEqual(1000, registration_slot_rank(ranks, "tank", ROLE_SHAPE, primary_rank=1000))
        self.assertEqual(3000, registration_slot_rank(ranks, "flex", FLEX_SHAPE, primary_rank=1000))
