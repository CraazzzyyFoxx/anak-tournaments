from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

from shared.core.enums import MapPickSide, VetoSeedSource  # noqa: E402
from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from src.services.encounter.veto_session import (  # noqa: E402
    build_sequence_for_best_of,
    build_slot_sequence,
    decide_seeds,
    effective_sequence,
    resolve_sequence_tokens,
    select_config,
    validate_veto_config,
)


def make_config(config_id: int, *, stage_id: int | None = None, round: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=config_id, stage_id=stage_id, round=round)


class SelectConfigTests(TestCase):
    def test_stage_round_level_wins_over_stage_and_tournament(self) -> None:
        configs = [
            make_config(1),
            make_config(2, stage_id=10),
            make_config(3, stage_id=10, round=2),
        ]

        chosen = select_config(configs, stage_id=10, round=2)

        self.assertEqual(3, chosen.id)

    def test_stage_level_wins_over_tournament_when_round_differs(self) -> None:
        configs = [
            make_config(1),
            make_config(2, stage_id=10),
            make_config(3, stage_id=10, round=5),
        ]

        chosen = select_config(configs, stage_id=10, round=2)

        self.assertEqual(2, chosen.id)

    def test_tournament_level_fallback_for_other_stage(self) -> None:
        configs = [
            make_config(1),
            make_config(2, stage_id=99),
        ]

        chosen = select_config(configs, stage_id=10, round=1)

        self.assertEqual(1, chosen.id)

    def test_no_applicable_config_returns_none(self) -> None:
        configs = [make_config(2, stage_id=99), make_config(3, stage_id=10, round=7)]

        self.assertIsNone(select_config(configs, stage_id=10, round=1))

    def test_stage_configs_ignored_for_stageless_encounter(self) -> None:
        configs = [make_config(2, stage_id=10), make_config(1)]

        chosen = select_config(configs, stage_id=None, round=1)

        self.assertEqual(1, chosen.id)


class DecideSeedsTests(TestCase):
    def test_bracket_slots_lower_slot_acts_first(self) -> None:
        resolution = decide_seeds(1, 4, None, None)

        self.assertEqual(VetoSeedSource.BRACKET_SLOT, resolution.seed_source)
        self.assertEqual(MapPickSide.HOME, resolution.first_side)
        self.assertEqual(1, resolution.home_seed)
        self.assertEqual(4, resolution.away_seed)

    def test_bracket_slots_away_acts_first_when_lower(self) -> None:
        resolution = decide_seeds(8, 3, None, None)

        self.assertEqual(MapPickSide.AWAY, resolution.first_side)
        self.assertEqual(VetoSeedSource.BRACKET_SLOT, resolution.seed_source)

    def test_slot_tie_falls_back_to_home(self) -> None:
        resolution = decide_seeds(2, 2, None, None)

        self.assertEqual(VetoSeedSource.FALLBACK_HOME, resolution.seed_source)
        self.assertEqual(MapPickSide.HOME, resolution.first_side)

    def test_standings_fallback_when_slots_missing(self) -> None:
        resolution = decide_seeds(None, None, 3, 1)

        self.assertEqual(VetoSeedSource.STANDINGS, resolution.seed_source)
        self.assertEqual(MapPickSide.AWAY, resolution.first_side)
        self.assertEqual(3, resolution.home_seed)
        self.assertEqual(1, resolution.away_seed)

    def test_partial_slot_falls_through_to_standings(self) -> None:
        resolution = decide_seeds(1, None, 2, 5)

        self.assertEqual(VetoSeedSource.STANDINGS, resolution.seed_source)
        self.assertEqual(MapPickSide.HOME, resolution.first_side)

    def test_standings_tie_falls_back_to_home(self) -> None:
        resolution = decide_seeds(None, None, 1, 1)

        self.assertEqual(VetoSeedSource.FALLBACK_HOME, resolution.seed_source)
        self.assertEqual(MapPickSide.HOME, resolution.first_side)

    def test_nothing_resolvable_falls_back_to_home_without_seeds(self) -> None:
        resolution = decide_seeds(None, None, None, None)

        self.assertEqual(VetoSeedSource.FALLBACK_HOME, resolution.seed_source)
        self.assertEqual(MapPickSide.HOME, resolution.first_side)
        self.assertIsNone(resolution.home_seed)
        self.assertIsNone(resolution.away_seed)


class ResolveSequenceTokensTests(TestCase):
    SEQUENCE = ["ban_first", "ban_second", "pick_first", "pick_second", "decider"]

    def test_first_side_home(self) -> None:
        self.assertEqual(
            ["ban_home", "ban_away", "pick_home", "pick_away", "decider"],
            resolve_sequence_tokens(self.SEQUENCE, MapPickSide.HOME),
        )

    def test_first_side_away(self) -> None:
        self.assertEqual(
            ["ban_away", "ban_home", "pick_away", "pick_home", "decider"],
            resolve_sequence_tokens(self.SEQUENCE, MapPickSide.AWAY),
        )

    def test_accepts_plain_string_side(self) -> None:
        self.assertEqual(["ban_away", "pick_home"], resolve_sequence_tokens(["ban_first", "pick_second"], "away"))


class ValidateVetoConfigTests(TestCase):
    MAPS = [1, 2, 3, 4, 5]

    def test_valid_bo3_sequence_passes(self) -> None:
        validate_veto_config(["ban_first", "ban_second", "pick_first", "pick_second", "decider"], self.MAPS)

    def test_rejects_unknown_token(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_veto_config(["ban_home"], self.MAPS)

        self.assertEqual(422, ctx.exception.status_code)
        self.assertIn("ban_home", str(ctx.exception.detail))

    def test_rejects_empty_sequence(self) -> None:
        with self.assertRaises(HTTPException):
            validate_veto_config([], self.MAPS)

    def test_rejects_decider_not_last(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_veto_config(["decider", "pick_first"], self.MAPS)

        self.assertEqual("decider must be the last step of the sequence", ctx.exception.detail)

    def test_rejects_multiple_deciders(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_veto_config(["pick_first", "decider", "decider"], self.MAPS)

        self.assertEqual("sequence may contain at most one decider step", ctx.exception.detail)

    def test_rejects_more_steps_than_maps(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_veto_config(["ban_first", "ban_second", "pick_first"], [1, 2])

        self.assertEqual("sequence has more steps than maps in the pool", ctx.exception.detail)

    def test_rejects_duplicate_map_ids(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_veto_config(["pick_first"], [1, 1])

        self.assertEqual("map_ids must be unique", ctx.exception.detail)

    def test_rejects_bans_only_sequence(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_veto_config(["ban_first", "ban_second"], self.MAPS)

        self.assertEqual("sequence must contain at least one pick or a decider", ctx.exception.detail)


class BuildSequenceForBestOfTests(TestCase):
    """The generated sequence must play exactly ``best_of`` maps and stay inside
    the pool, and it must reproduce the presets the admin editor already ships."""

    def test_reproduces_the_shipped_presets_token_for_token(self) -> None:
        self.assertEqual(
            ["ban_first", "ban_second", "pick_first", "pick_second"],
            build_sequence_for_best_of(2, 4),
        )
        self.assertEqual(
            ["ban_first", "ban_second", "pick_first", "pick_second", "decider"],
            build_sequence_for_best_of(3, 5),
        )
        self.assertEqual(
            [
                "ban_first",
                "ban_second",
                "pick_first",
                "pick_second",
                "pick_first",
                "pick_second",
                "decider",
            ],
            build_sequence_for_best_of(5, 7),
        )

    def test_bo1_bans_the_pool_down_to_one_map(self) -> None:
        self.assertEqual(
            ["ban_first", "ban_second", "ban_first", "ban_second", "decider"],
            build_sequence_for_best_of(1, 5),
        )

    def test_covers_bo7_which_had_no_preset(self) -> None:
        sequence = build_sequence_for_best_of(7, 9)

        self.assertEqual(9, len(sequence))
        self.assertEqual(7, sum(1 for token in sequence if not token.startswith("ban")))
        self.assertEqual("decider", sequence[-1])

    def test_plays_exactly_best_of_maps_and_validates_for_every_length(self) -> None:
        for best_of in (1, 2, 3, 4, 5, 6, 7):
            pool = list(range(1, best_of + 3))
            sequence = build_sequence_for_best_of(best_of, len(pool))
            played = sum(1 for token in sequence if not token.startswith("ban"))

            self.assertEqual(best_of, played, f"best_of={best_of}")
            # Whatever it generates must survive the upsert validator.
            validate_veto_config(sequence, pool)

    def test_drops_opening_bans_rather_than_outgrow_a_tight_pool(self) -> None:
        # Pool exactly the series length: no room for bans at all.
        sequence = build_sequence_for_best_of(3, 3)

        self.assertEqual(["pick_first", "pick_second", "decider"], sequence)
        validate_veto_config(sequence, [1, 2, 3])

    def test_clamps_a_series_longer_than_the_pool(self) -> None:
        sequence = build_sequence_for_best_of(7, 3)

        self.assertLessEqual(len(sequence), 3)
        validate_veto_config(sequence, [1, 2, 3])

    def test_empty_pool_yields_no_steps(self) -> None:
        self.assertEqual([], build_sequence_for_best_of(3, 0))


class EffectiveSequenceTests(TestCase):
    """The bracket owns series length; only an explicit ``custom`` opts out."""

    TEMPLATE = ["ban_first", "ban_second", "pick_first", "pick_second", "decider"]

    @staticmethod
    def config(preset: str | None, sequence: list[str]) -> SimpleNamespace:
        return SimpleNamespace(preset=preset, veto_sequence_json=sequence)

    def test_regenerates_a_preset_config_from_the_bracket(self) -> None:
        # A Bo3 template on a Bo2 encounter used to hand a two-map series a
        # three-map veto.
        sequence = effective_sequence(self.config("bo3", self.TEMPLATE), 2, 7)

        self.assertEqual(2, sum(1 for token in sequence if not token.startswith("ban")))

    def test_passes_an_explicit_custom_order_through_untouched(self) -> None:
        custom = ["pick_second", "pick_first", "ban_first", "decider"]

        self.assertEqual(custom, effective_sequence(self.config("custom", custom), 5, 9))

    def test_the_bracket_sentinel_is_regenerated(self) -> None:
        sequence = effective_sequence(self.config("bracket", self.TEMPLATE), 7, 9)

        self.assertEqual(7, sum(1 for token in sequence if not token.startswith("ban")))

    def test_a_null_preset_is_a_template_not_a_hand_authored_order(self) -> None:
        sequence = effective_sequence(self.config(None, self.TEMPLATE), 5, 9)

        self.assertEqual(5, sum(1 for token in sequence if not token.startswith("ban")))

    def test_keeps_the_template_when_best_of_is_degenerate(self) -> None:
        # Legacy rows carry best_of=0; an empty veto is worse than the template.
        self.assertEqual(self.TEMPLATE, effective_sequence(self.config("bo3", self.TEMPLATE), 0, 7))

    def test_preset_config_follows_a_per_encounter_override(self) -> None:
        config = self.config("bo3", self.TEMPLATE)

        for best_of in (1, 2, 3, 5, 7):
            played = sum(1 for token in effective_sequence(config, best_of, 9) if not token.startswith("ban"))
            self.assertEqual(best_of, played, f"best_of={best_of}")


class BuildSlotSequenceTests(TestCase):
    """One slot = (candidates - 1) alternating bans, then a decider.
    Steps must total the pool size, because `get_current_step` indexes the flat
    token list by how many pool entries are no longer AVAILABLE."""

    def test_two_slots_of_three_alternating_from_the_higher_seed(self) -> None:
        self.assertEqual(
            ["ban_first", "ban_second", "decider", "ban_first", "ban_second", "decider"],
            build_slot_sequence([3, 3], rotation="fixed"),
        )

    def test_alternate_rotation_flips_who_opens_each_slot(self) -> None:
        self.assertEqual(
            ["ban_first", "ban_second", "decider", "ban_second", "ban_first", "decider"],
            build_slot_sequence([3, 3], rotation="alternate"),
        )

    def test_step_count_equals_total_candidates(self) -> None:
        for counts in ([3, 3], [3, 3, 3], [2, 4], [3, 3, 3, 3, 3]):
            sequence = build_slot_sequence(counts, rotation="fixed")
            self.assertEqual(sum(counts), len(sequence), f"counts={counts}")
            self.assertEqual(len(counts), sequence.count("decider"), f"counts={counts}")

    def test_one_decider_per_slot_and_each_closes_its_slot(self) -> None:
        sequence = build_slot_sequence([2, 3], rotation="fixed")
        self.assertEqual(["ban_first", "decider", "ban_first", "ban_second", "decider"], sequence)

    def test_empty_slot_list_yields_no_steps(self) -> None:
        self.assertEqual([], build_slot_sequence([], rotation="fixed"))

    def test_a_single_candidate_slot_is_played_unbanned(self) -> None:
        # A 1-candidate slot has no bans to spend, so it is one step -- its
        # decider -- and the pool-size invariant still holds. Pinned as the
        # generator's arithmetic, NOT as an endorsement: design Decision 15
        # forbids c_i < 2 because consecutive deciders stall the engine, and
        # rejecting it belongs to the mode-aware validator (task 5) and to
        # session creation, not to this pure function.
        sequence = build_slot_sequence([1, 3], rotation="fixed")

        self.assertEqual(["decider", "ban_first", "ban_second", "decider"], sequence)
        self.assertEqual(4, len(sequence))
