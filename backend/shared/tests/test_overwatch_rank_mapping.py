from __future__ import annotations

from unittest import TestCase

from shared.disciplines.overwatch.collector.domain import map_division_tier_to_rank_value


class MappingTests(TestCase):
    def test_ladder_values_are_sr_aligned(self) -> None:
        # Tier 5 = bottom of division, tier 1 = top (+400).
        self.assertEqual(map_division_tier_to_rank_value("bronze", 5), 500)
        self.assertEqual(map_division_tier_to_rank_value("bronze", 1), 900)
        self.assertEqual(map_division_tier_to_rank_value("emerald", 5), 2500)
        # Diamond and above keep their v1 anchors: emerald took the band that
        # platinum vacated, so only bronze..platinum moved down by 500.
        self.assertEqual(map_division_tier_to_rank_value("diamond", 3), 3200)
        self.assertEqual(map_division_tier_to_rank_value("ultimate", 1), 4900)

    def test_map_is_case_insensitive_and_null_safe(self) -> None:
        self.assertEqual(map_division_tier_to_rank_value("Diamond", 3), 3200)
        self.assertIsNone(map_division_tier_to_rank_value(None, None))
        self.assertIsNone(map_division_tier_to_rank_value("bronze", None))
        self.assertIsNone(map_division_tier_to_rank_value("unknown", 1))
