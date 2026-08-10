from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase, TestCase

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

from shared.core.enums import (  # noqa: E402
    FirstBanRotation,
    MapPickSide,
    MapPoolEntryStatus,
    MapVetoMode,
    VetoSeedSource,
)
from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.tests import eager_loading  # noqa: E402
from src import models  # noqa: E402
from src.services.encounter.veto_session import (  # noqa: E402
    REASON_NOT_CONFIGURED,
    REASON_SLOT_COUNT_MISMATCH,
    REASON_SLOT_UNDERFILLED,
    REASON_TEAMS_UNKNOWN,
    build_sequence_for_best_of,
    build_slot_sequence,
    decide_seeds,
    effective_sequence,
    ensure_veto_session,
    ordered_slots,
    resolve_sequence_tokens,
    select_config,
    slot_candidates,
    slot_refusal,
    slot_reserves,
    slots_in_play,
    unavailable_reason,
    validate_slot_config,
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
        # ``mode`` is NOT NULL with a server default, so every real row carries
        # it; a fixture without it models a config that cannot exist.
        return SimpleNamespace(mode=MapVetoMode.POOL, preset=preset, veto_sequence_json=sequence)

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


class EffectiveSequenceSlotModeTests(TestCase):
    """Slot mode derives its sequence from the slot structure, never from
    ``best_of``, the stored template or the flat pool size."""

    #: Impossible as a slot sequence -- slot mode never emits a pick -- so an
    #: implementation that fell through to the flat path or returned the stored
    #: template is visible rather than merely differently shaped.
    TEMPLATE = ["pick_first", "pick_second"]

    #: Two three-candidate slots under ``fixed`` rotation.
    FIXED_3_3 = ["ban_first", "ban_second", "decider", "ban_first", "ban_second", "decider"]

    @staticmethod
    def config(
        *,
        rotation: str = "fixed",
        mode: MapVetoMode = MapVetoMode.SLOTS,
        preset: str | None = "bracket",
    ) -> SimpleNamespace:
        return SimpleNamespace(
            mode=mode,
            preset=preset,
            first_ban_rotation=rotation,
            veto_sequence_json=EffectiveSequenceSlotModeTests.TEMPLATE,
        )

    def test_derives_the_sequence_from_the_slots_not_the_stored_template(self) -> None:
        sequence = effective_sequence(self.config(), 2, 6, slots=[[1, 2, 3], [4, 5, 6]])

        self.assertEqual(self.FIXED_3_3, sequence)

    def test_the_configured_rotation_reaches_the_generator(self) -> None:
        # ``alternate`` flips the second slot's opener; a hardcoded ``fixed``
        # (or the preset passed in rotation's place) produces FIXED_3_3.
        sequence = effective_sequence(self.config(rotation="alternate"), 2, 6, slots=[[1, 2, 3], [4, 5, 6]])

        self.assertEqual(
            ["ban_first", "ban_second", "decider", "ban_second", "ban_first", "decider"],
            sequence,
        )

    def test_each_slot_contributes_its_own_candidate_count(self) -> None:
        # Counts 2/4/3: deriving them from the slot count instead of each slot's
        # map count, or emitting them in another order, changes these tokens.
        sequence = effective_sequence(self.config(), 3, 9, slots=[[1, 2], [3, 4, 5, 6], [7, 8, 9]])

        self.assertEqual(
            [
                "ban_first",
                "decider",
                "ban_first",
                "ban_second",
                "ban_first",
                "decider",
                "ban_first",
                "ban_second",
                "decider",
            ],
            sequence,
        )

    def test_uneven_slots_keep_one_step_per_pool_entry(self) -> None:
        # ``get_current_step`` indexes the token list by how many pool entries
        # are no longer AVAILABLE, so the total must equal the pool size.
        shapes = (
            [[1, 2], [3, 4]],
            [[1, 2], [3, 4, 5, 6], [7, 8, 9]],
            [[1, 2, 3], [4, 5], [6, 7, 8, 9], [10, 11]],
            [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]],
        )
        for slots in shapes:
            pool_size = sum(len(candidates) for candidates in slots)
            for rotation in ("fixed", "alternate"):
                with self.subTest(slots=slots, rotation=rotation):
                    # ``best_of=0`` deliberately: passing ``len(slots)`` is the
                    # one value for which a ``best_of``-derived slot count is a
                    # no-op, so it would make every shape here blind to it --
                    # and it would read as load-bearing in a mode that ignores
                    # ``best_of`` entirely.
                    sequence = effective_sequence(self.config(rotation=rotation), 0, pool_size, slots=slots)

                    self.assertEqual(pool_size, len(sequence))
                    self.assertEqual(len(slots), sequence.count("decider"))
                    self.assertEqual([], [token for token in sequence if token.startswith("pick")])

    def test_a_degenerate_best_of_does_not_fall_back_to_the_template(self) -> None:
        # Slot count is the series length, so a legacy ``best_of=0`` says nothing
        # about a slot config -- the slots are self-describing.
        self.assertEqual(self.FIXED_3_3, effective_sequence(self.config(), 0, 6, slots=[[1, 2, 3], [4, 5, 6]]))

    def test_a_custom_preset_cannot_opt_a_slot_config_out(self) -> None:
        # ``ck_map_veto_config_slots_not_custom`` makes this row unstorable; the
        # slot structure winning anyway keeps a dropped CHECK from resurrecting
        # a hand-authored order that slot mode has no way to run.
        sequence = effective_sequence(self.config(preset="custom"), 3, 6, slots=[[1, 2, 3], [4, 5, 6]])

        self.assertEqual(self.FIXED_3_3, sequence)

    def test_an_empty_slot_list_yields_no_steps(self) -> None:
        self.assertEqual([], effective_sequence(self.config(), 0, 0, slots=[]))

    def test_missing_slot_data_raises_instead_of_running_a_flat_veto(self) -> None:
        # Distinguished from ``slots=[]``: absent data is the caller's bug, and
        # a silent flat sequence would be a plausible-looking wrong veto.
        with self.assertRaises(TypeError):
            effective_sequence(self.config(), 3, 9)

    def test_a_pool_mode_config_ignores_slot_candidates(self) -> None:
        # The dispatch's other direction: routing pool mode into the slot branch
        # would silently re-shape every existing tournament's veto.
        sequence = effective_sequence(
            self.config(mode=MapVetoMode.POOL, rotation="alternate"), 3, 5, slots=[[1, 2, 3], [4, 5, 6]]
        )

        self.assertEqual(["ban_first", "ban_second", "pick_first", "pick_second", "decider"], sequence)


class SlotCandidatesTests(TestCase):
    """``position`` order, not row order.

    A ``SELECT`` without ``ORDER BY`` returns rows in no guaranteed order, and a
    mis-ordered slot list still satisfies every invariant this module protects --
    the step total is unchanged -- while offering one slot's ban count to
    another. Hence the sort lives here, where a test can pin it.
    """

    @staticmethod
    def slot(position: int, map_ids: list[int]) -> SimpleNamespace:
        return SimpleNamespace(position=position, maps=[SimpleNamespace(map_id=map_id) for map_id in map_ids])

    #: Positions out of order, candidate counts unequal and not ascending, so a
    #: missing sort produces a different sequence rather than the same one.
    def rows(self) -> list[SimpleNamespace]:
        return [self.slot(2, [3, 4, 5, 6]), self.slot(1, [1, 2]), self.slot(3, [7, 8, 9])]

    def test_sorts_by_position_regardless_of_row_order(self) -> None:
        self.assertEqual([[1, 2], [3, 4, 5, 6], [7, 8, 9]], slot_candidates(self.rows()))

    def test_row_order_would_change_the_sequence_without_changing_its_length(self) -> None:
        rows = self.rows()
        ordered = build_slot_sequence([len(candidates) for candidates in slot_candidates(rows)], rotation="fixed")
        unordered = build_slot_sequence([len(slot.maps) for slot in rows], rotation="fixed")

        self.assertNotEqual(unordered, ordered)
        # Same step total: the invariant cannot catch this, only the sort can.
        self.assertEqual(len(unordered), len(ordered))

    def test_keeps_each_slot_s_own_candidate_order(self) -> None:
        # ``MapVetoConfigSlot.maps`` is ordered by ``sort_order``; the ids must
        # not be re-sorted on the way out.
        self.assertEqual([[9, 3, 7]], slot_candidates([self.slot(1, [9, 3, 7])]))

    def test_a_slot_with_no_candidates_is_kept_as_an_empty_list(self) -> None:
        # The loader outer-joins deliberately: dropping the slot would shorten
        # the sequence and hide a catalogue delete that took a slot below two.
        self.assertEqual([[1, 2], []], slot_candidates([self.slot(1, [1, 2]), self.slot(2, [])]))


class BuildSlotSequenceTests(TestCase):
    """One slot = (candidates - 1) alternating bans, then a decider.

    Steps must total the pool size, because ``get_current_step`` indexes the
    flat token list by how many pool entries are no longer AVAILABLE.
    """

    def test_fixed_rotation_opens_every_slot_with_the_higher_seed(self) -> None:
        self.assertEqual(
            ["ban_first", "ban_second", "decider", "ban_first", "ban_second", "decider"],
            build_slot_sequence([3, 3], rotation="fixed"),
        )

    def test_alternate_rotation_flips_who_opens_each_slot(self) -> None:
        self.assertEqual(
            ["ban_first", "ban_second", "decider", "ban_second", "ban_first", "decider"],
            build_slot_sequence([3, 3], rotation="alternate"),
        )

    def test_step_and_decider_counts_match_the_slot_shape(self) -> None:
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


class ValidateSlotConfigTests(TestCase):
    """Slot-mode upsert validation (design Decision 15/16)."""

    def test_rejects_a_slot_with_fewer_than_two_candidates(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_slot_config([[1, 2, 3], [4]], reserves=[None, None])

        self.assertEqual(422, ctx.exception.status_code)
        self.assertIn("slot 2 must have at least two candidate maps", ctx.exception.detail)

    def test_rejects_an_empty_slot_list(self) -> None:
        with self.assertRaises(HTTPException):
            validate_slot_config([], reserves=[])

    def test_rejects_a_reserve_list_that_does_not_match_the_slot_count(self) -> None:
        # The reserve list is positional: a short or long list silently
        # misaligns every reserve after the gap.
        with self.assertRaises(HTTPException) as ctx:
            validate_slot_config([[1, 2], [3, 4]], reserves=[None])

        self.assertEqual(422, ctx.exception.status_code)
        self.assertIn("one entry per slot", ctx.exception.detail)

    def test_rejects_duplicate_candidates_within_one_slot(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_slot_config([[1, 1, 2]], reserves=[None])

        self.assertEqual(422, ctx.exception.status_code)
        # The message names the offending map: the regulation's near-miss
        # spellings make "this slot has a duplicate" unactionable by eye.
        self.assertIn("slot 1 must not repeat candidate map(s): 1", ctx.exception.detail)

    def test_allows_the_same_map_in_two_different_slots(self) -> None:
        """A map may be a candidate of one slot and of another; only within-slot
        duplication is meaningless (design Decision 9/11)."""
        validate_slot_config([[1, 2], [1, 3]], reserves=[None, None])

    def test_rejects_a_reserve_that_is_a_candidate_of_its_own_slot(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            validate_slot_config([[1, 2], [3, 4]], reserves=[2, None])

        self.assertEqual(422, ctx.exception.status_code)
        self.assertIn("slot 1 reserve must not be one of its own candidates", ctx.exception.detail)

    def test_reports_the_candidate_floor_before_the_reserve_rule(self) -> None:
        # A slot that breaks both rules must report the more fundamental one,
        # or the organizer is sent to the reserve control to fix a slot whose
        # real problem is that it has nothing to ban.
        with self.assertRaises(HTTPException) as ctx:
            validate_slot_config([[1]], reserves=[1])

        self.assertIn("at least two candidate maps", ctx.exception.detail)

    def test_allows_a_reserve_that_is_also_a_candidate_elsewhere(self) -> None:
        # The permitted side of the boundary the test above rejects: map 3 is
        # slot 1's reserve and slot 2's candidate, which Decision 7 allows
        # because a reserve is never a pool entry and never activates.
        validate_slot_config([[1, 2], [3, 4]], reserves=[3, None])


# ── session creation: slots, reserves, reconciliation ────────────────────────


def _slot(position: int, map_ids: list[int], *, reserve: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        position=position,
        reserve_map_id=reserve,
        maps=[SimpleNamespace(map_id=map_id) for map_id in map_ids],
    )


class _Result:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _Result:
        return self

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalar_one_or_none(self) -> Any:
        return self._rows[0] if self._rows else None


class _FakeSession:
    """Just enough ``AsyncSession`` for ``ensure_veto_session``.

    Dispatches on the statement's primary mapped entity rather than on call
    order, so adding or reordering a query in the service cannot silently make a
    test assert against the wrong result set -- it raises instead.

    ``scalar`` sees two shapes: the pool-size ``count()`` probe (no entity) and
    ``resolve_seeds``' previous-stage lookup (``Stage``). Answering the latter
    with ``None`` short-circuits the standings branch, so every session here
    lands on ``fallback_home`` and the resolved sequence is readable.
    """

    def __init__(
        self,
        *,
        config: Any = None,
        slot_rows: list[Any] | None = None,
        existing: Any = None,
        pool_count: int = 0,
    ) -> None:
        self.config = config
        self.slot_rows = list(slot_rows or [])
        self.existing = existing
        self.pool_count = pool_count
        self.added: list[Any] = []
        self.slot_statements: list[Any] = []
        self.commits = 0

    async def execute(self, statement: Any) -> _Result:
        entity = statement.column_descriptions[0]["entity"]
        if entity is models.EncounterVetoSession:
            return _Result([] if self.existing is None else [self.existing])
        if entity is models.MapVetoConfig:
            return _Result([] if self.config is None else [self.config])
        if entity is models.MapVetoConfigSlot:
            self.slot_statements.append(statement)
            return _Result(self.slot_rows)
        raise AssertionError(f"unexpected execute() entity: {entity}")

    async def scalar(self, statement: Any) -> Any:
        entity = statement.column_descriptions[0]["entity"]
        if entity is None:
            return self.pool_count
        if entity is models.Stage:
            return None
        raise AssertionError(f"unexpected scalar() entity: {entity}")

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:  # pragma: no cover - no IntegrityError here
        return None

    @property
    def pool_rows(self) -> list[models.EncounterMapPool]:
        return [row for row in self.added if isinstance(row, models.EncounterMapPool)]

    @property
    def slot_queries(self) -> int:
        return len(self.slot_statements)


def _encounter(*, best_of: int, home: int | None = 10, away: int | None = 20) -> SimpleNamespace:
    return SimpleNamespace(
        id=500,
        tournament_id=7,
        stage_id=3,
        stage_item_id=None,
        round=2,
        best_of=best_of,
        home_team_id=home,
        away_team_id=away,
    )


def _config(
    *,
    mode: MapVetoMode = MapVetoMode.SLOTS,
    rotation: str = FirstBanRotation.FIXED,
    map_pool: list[int] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=42,
        stage_id=None,
        round=None,
        mode=mode,
        preset="bracket",
        first_ban_rotation=rotation,
        veto_sequence_json=["pick_first", "pick_second"],
        turn_timer_seconds=45,
        map_pool=[SimpleNamespace(map_id=map_id) for map_id in (map_pool or [])],
    )


class SlotRefusalTests(TestCase):
    """The two refusal rules, and which one outranks the other.

    ``slot_refusal`` no longer truncates: ``_slot_plan`` hands it the in-play
    counts and the total slot count separately, so "check the floor before
    truncating" is not expressible here. The ordering is pinned end to end
    instead, by ``EnsureVetoSessionSlotModeTests`` and ``UnavailableReasonTests``,
    which go through the real ``_slot_plan``.
    """

    #: Candidate counts, unequal and not ascending. Nothing here is a position:
    #: ``slot_refusal`` never sees one. Position-versus-index confusion is pinned
    #: by ``SlotsInPlayTests`` and the session tests, which use real slot rows.
    SHAPE = [2, 4, 3, 5]

    def test_best_of_equal_to_the_slot_count_is_playable(self) -> None:
        self.assertIsNone(slot_refusal(self.SHAPE, slot_count=4, best_of=4))

    def test_fewer_maps_than_slots_is_playable(self) -> None:
        # Four slots, three played: the in-play counts are the truncated ones.
        self.assertIsNone(slot_refusal([2, 4, 3], slot_count=4, best_of=3))

    def test_more_maps_than_slots_refuses(self) -> None:
        # The bracket wants five maps from four slots; there is nothing to play
        # as the fifth, and inventing one would hand the match a short series
        # nobody chose.
        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, slot_refusal(self.SHAPE, slot_count=4, best_of=5))

    def test_an_underfilled_slot_in_play_refuses(self) -> None:
        # One candidate, not zero: the boundary a ``< 1`` floor would wave
        # through, and the shape a catalogue delete actually leaves behind.
        self.assertEqual(REASON_SLOT_UNDERFILLED, slot_refusal([2, 1, 3], slot_count=4, best_of=3))

    def test_an_empty_slot_in_play_refuses(self) -> None:
        self.assertEqual(REASON_SLOT_UNDERFILLED, slot_refusal([2, 0, 3], slot_count=4, best_of=3))

    def test_the_bracket_disagreement_outranks_the_floor(self) -> None:
        # Both wrong at once. "Your config has too few slots" is actionable;
        # "slot 2 is underfilled" sends the organizer to the wrong control, and
        # with ``best_of`` past the slot count there is no in-play set to report
        # on.
        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, slot_refusal([2, 1], slot_count=2, best_of=4))

    def test_a_degenerate_best_of_is_playable_when_slots_exist(self) -> None:
        # Legacy rows carry ``best_of=0``, which says nothing about a config whose
        # slots describe their own length (matching ``effective_sequence``), so
        # every slot is in play and the floor still applies to all of them.
        self.assertIsNone(slot_refusal(self.SHAPE, slot_count=4, best_of=0))
        self.assertEqual(REASON_SLOT_UNDERFILLED, slot_refusal([2, 4, 3, 1], slot_count=4, best_of=0))

    def test_a_config_with_no_slots_refuses_at_every_best_of(self) -> None:
        # ``0 > 0`` is False and ``any([])`` is False, so without the explicit
        # empty guard a legacy ``best_of=0`` against a config whose last slot was
        # deleted builds a session with an empty sequence, an empty reserve
        # snapshot and no pool rows -- the dead room ``slots_in_play`` refuses to
        # truncate into, reached from the other side.
        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, slot_refusal([], slot_count=0, best_of=0))
        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, slot_refusal([], slot_count=0, best_of=-1))
        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, slot_refusal([], slot_count=0, best_of=3))


class SlotsInPlayTests(TestCase):
    """Position order first, then the ``best_of`` prefix."""

    def rows(self) -> list[SimpleNamespace]:
        return [_slot(5, [31, 32, 33]), _slot(1, [11, 12]), _slot(8, [41, 42]), _slot(3, [21, 22, 23, 24])]

    def test_orders_by_position_regardless_of_row_order(self) -> None:
        self.assertEqual([1, 3, 5, 8], [row.position for row in ordered_slots(self.rows())])

    def test_takes_the_first_best_of_slots_in_position_order(self) -> None:
        # Row order alone would give 5/1/8; list-index truncation of the raw
        # rows would give 5/1/8 too. Only sort-then-slice gives 1/3/5.
        self.assertEqual([1, 3, 5], [row.position for row in slots_in_play(self.rows(), 3)])

    def test_best_of_equal_to_the_slot_count_plays_all(self) -> None:
        self.assertEqual([1, 3, 5, 8], [row.position for row in slots_in_play(self.rows(), 4)])

    def test_a_degenerate_best_of_plays_all(self) -> None:
        self.assertEqual([1, 3, 5, 8], [row.position for row in slots_in_play(self.rows(), 0)])


class SlotReservesSnapshotTests(TestCase):
    """``{position: reserve_map_id}``, string-keyed, only for slots that have one."""

    def test_only_slots_with_a_reserve_appear(self) -> None:
        rows = [_slot(1, [11, 12]), _slot(3, [21, 22], reserve=99), _slot(5, [31, 32])]

        self.assertEqual({"3": 99}, slot_reserves(rows))

    def test_keys_are_strings_so_the_value_survives_a_json_round_trip(self) -> None:
        # The column is JSON: an int-keyed dict is written as ``{"3": 99}`` and
        # read back string-keyed, so the in-memory session would disagree with
        # the persisted one and a frontend indexing by slot number would find
        # nothing on one side of the round trip.
        snapshot = slot_reserves([_slot(3, [21, 22], reserve=99)])

        self.assertEqual(["3"], list(snapshot))
        self.assertNotIn(3, snapshot)
        self.assertEqual(snapshot, json.loads(json.dumps(snapshot)))

    def test_no_reserves_is_an_empty_snapshot_not_a_missing_one(self) -> None:
        # Distinguishable from flat mode's NULL: a snapshot was taken and the
        # config had nothing to label.
        self.assertEqual({}, slot_reserves([_slot(1, [11, 12])]))


class EnsureVetoSessionSlotModeTests(IsolatedAsyncioTestCase):
    """Session creation in slot mode: pool rows, reserve snapshot, refusals.

    The fixture is deliberately awkward: four slots at positions 1/3/5/8 with
    candidate counts 2/4/3/5, played at ``best_of=3``, rows returned scrambled.
    The property that carries these tests is per-slot: for every slot but the
    first, its ``position`` equals neither its list index nor its candidate
    count, so a stamp built from either is visible. ``best_of`` is NOT distinct
    from all of them (3 is also slot 2's position and slot 3's count) — it does
    not need to be, because what it has to differ from is the slot count, 4.

    The only reserved slots are one in play (position 3) and one out of play
    (position 8), so a snapshot that ignores truncation and one that ignores the
    "has a reserve" filter fail differently.
    """

    RESERVE_IN_PLAY = 99
    RESERVE_OUT_OF_PLAY = 98

    def slot_rows(self) -> list[SimpleNamespace]:
        # Scrambled on purpose: a query without ORDER BY returns rows in no
        # guaranteed order.
        return [
            _slot(5, [31, 32, 33]),
            _slot(1, [11, 12]),
            _slot(8, [41, 42, 43, 44, 45], reserve=self.RESERVE_OUT_OF_PLAY),
            _slot(3, [21, 22, 23, 24], reserve=self.RESERVE_IN_PLAY),
        ]

    async def _create(self, *, best_of: int = 3, slot_rows: list[Any] | None = None, **kwargs: Any):
        session = _FakeSession(
            config=_config(),
            slot_rows=self.slot_rows() if slot_rows is None else slot_rows,
            **kwargs,
        )
        veto = await ensure_veto_session(session, _encounter(best_of=best_of))
        return session, veto

    async def test_pool_rows_carry_the_slot_position_not_its_index(self) -> None:
        session, veto = await self._create()

        self.assertIsNotNone(veto)
        # Positions 1/3/5 repeated by candidate count -- never 0/1/2 (list
        # index) and never 1/2/3 (index + 1).
        self.assertEqual([1, 1, 3, 3, 3, 3, 5, 5, 5], [row.slot for row in session.pool_rows])
        self.assertEqual([11, 12, 21, 22, 23, 24, 31, 32, 33], [row.map_id for row in session.pool_rows])
        # ``order`` runs across the whole pool, as flat mode's does.
        self.assertEqual(list(range(9)), [row.order for row in session.pool_rows])
        self.assertEqual({MapPoolEntryStatus.AVAILABLE}, {row.status for row in session.pool_rows})
        self.assertEqual({500}, {row.encounter_id for row in session.pool_rows})

    async def test_the_sequence_has_one_step_per_pool_row(self) -> None:
        session, veto = await self._create()

        # ``get_current_step`` indexes the token list by resolved pool entries.
        self.assertEqual(len(session.pool_rows), len(veto.resolved_sequence_json))
        self.assertEqual(3, veto.resolved_sequence_json.count("decider"))
        self.assertEqual(
            [
                "ban_home",
                "decider",
                "ban_home",
                "ban_away",
                "ban_home",
                "decider",
                "ban_home",
                "ban_away",
                "decider",
            ],
            veto.resolved_sequence_json,
        )

    async def test_the_reserve_snapshot_covers_only_reserved_slots_in_play(self) -> None:
        _, veto = await self._create()

        # Position 8 has a reserve but is out of play at ``best_of=3``; labelling
        # it would advertise a fallback for a map the match never plays.
        self.assertEqual({"3": self.RESERVE_IN_PLAY}, veto.slot_reserves_json)

    async def test_the_reserve_snapshot_does_not_follow_a_later_config_edit(self) -> None:
        rows = self.slot_rows()
        session = _FakeSession(config=_config(), slot_rows=rows)
        encounter = _encounter(best_of=3)
        veto = await ensure_veto_session(session, encounter)
        snapshot = veto.slot_reserves_json

        # The admin edits the config's reserves afterwards. The session already
        # exists, so re-ensuring returns it untouched (Decision 18) -- the room
        # must keep labelling what it started with.
        for row in rows:
            row.reserve_map_id = 777
        session.existing = veto
        again = await ensure_veto_session(session, encounter)

        self.assertIs(veto, again)
        self.assertEqual({"3": self.RESERVE_IN_PLAY}, snapshot)
        self.assertEqual({"3": self.RESERVE_IN_PLAY}, veto.slot_reserves_json)

    async def test_the_slots_are_loaded_once(self) -> None:
        # Positions, candidates and reserves all come off the same load: a
        # second query is a second source of truth that a concurrent config
        # edit can make disagree with the first.
        session, _ = await self._create()

        self.assertEqual(1, session.slot_queries)

    async def test_more_maps_than_slots_creates_nothing(self) -> None:
        session, veto = await self._create(best_of=5)

        self.assertIsNone(veto)
        self.assertEqual([], session.added)
        self.assertEqual(0, session.commits)

    async def test_an_underfilled_slot_in_play_creates_nothing(self) -> None:
        rows = [_slot(1, [11, 12]), _slot(3, [21]), _slot(5, [31, 32, 33]), _slot(8, [41, 42])]

        session, veto = await self._create(slot_rows=rows)

        self.assertIsNone(veto)
        self.assertEqual([], session.added)

    async def test_an_underfilled_slot_out_of_play_still_creates_the_session(self) -> None:
        # A catalogue delete emptied slot 8, which ``best_of=3`` never reaches.
        # This is where the floor's ORDERING is pinned: ``_slot_plan`` truncates
        # first, so running the floor over all four slots refuses a match that is
        # perfectly playable.
        rows = [_slot(1, [11, 12]), _slot(3, [21, 22, 23, 24]), _slot(5, [31, 32, 33]), _slot(8, [41])]

        session, veto = await self._create(slot_rows=rows)

        self.assertIsNotNone(veto)
        self.assertEqual([1, 1, 3, 3, 3, 3, 5, 5, 5], [row.slot for row in session.pool_rows])

    async def test_a_config_with_no_slots_creates_nothing_even_at_best_of_zero(self) -> None:
        # ``best_of=0`` is the one value at which the reconciliation's ``>``
        # comparison cannot fire, so without the explicit empty guard this builds
        # a session with an empty sequence, ``slot_reserves_json == {}`` and no
        # pool rows: a room that renders, accepts nothing and never completes.
        session, veto = await self._create(best_of=0, slot_rows=[])

        self.assertIsNone(veto)
        self.assertEqual([], session.added)
        self.assertEqual(0, session.commits)


class LoadSlotRowsEagerLoadTests(IsolatedAsyncioTestCase):
    """``load_slot_rows``' own eager load, which is what keeps every other
    slot-mode reader off the lazy ``MapVetoConfig.slots`` relationship.

    ``resolve_config`` deliberately does NOT carry a slot chain: its consumers
    read only columns (``mode``, ``id``, ``turn_timer_seconds``) and the
    eager-loaded ``map_pool``, and every slot row they need arrives through this
    query instead. So this one option carries the whole slot-mode session path,
    and nothing else in the suite pinned it.

    ``MapVetoConfigSlot.maps`` is lazy like its parent. ``_slot_plan`` reads
    ``row.maps`` for the candidate floor and ``slot_candidates`` reads it again
    for the sequence, both after this await -- so a dropped option is
    ``MissingGreenlet`` on every slot-mode session creation and on every
    ``unavailable_reason`` that has to name a slot refusal.
    """

    async def test_the_slot_query_eager_loads_each_slot_s_candidates(self) -> None:
        session = _FakeSession(config=_config(), slot_rows=[_slot(1, [11, 12]), _slot(2, [21, 22])])

        veto = await ensure_veto_session(session, _encounter(best_of=2))

        self.assertIsNotNone(veto)
        eager_loading.assert_eager_loads(self, session.slot_statements[0], "MapVetoConfigSlot.maps")

    async def test_the_refusal_path_loads_the_candidates_it_counts(self) -> None:
        # ``unavailable_reason`` reaches ``row.maps`` through the same helper but
        # from a different caller, and it runs on encounters that never gain a
        # session -- so the room re-pays for it on every poll.
        session = _FakeSession(config=_config(), slot_rows=[_slot(1, [11, 12])])

        reason = await unavailable_reason(session, _encounter(best_of=3))

        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, reason)
        eager_loading.assert_eager_loads(self, session.slot_statements[0], "MapVetoConfigSlot.maps")


class EnsureVetoSessionFlatModeTests(IsolatedAsyncioTestCase):
    """Flat mode must be untouched by slot mode's arrival."""

    async def test_flat_pool_rows_have_no_slot_and_no_reserve_snapshot(self) -> None:
        session = _FakeSession(config=_config(mode=MapVetoMode.POOL, map_pool=[11, 12, 13, 14, 15]))

        veto = await ensure_veto_session(session, _encounter(best_of=3))

        self.assertEqual([None] * 5, [row.slot for row in session.pool_rows])
        self.assertEqual([11, 12, 13, 14, 15], [row.map_id for row in session.pool_rows])
        self.assertEqual(list(range(5)), [row.order for row in session.pool_rows])
        self.assertIsNone(veto.slot_reserves_json)
        self.assertEqual(["ban_home", "ban_away", "pick_home", "pick_away", "decider"], veto.resolved_sequence_json)

    async def test_flat_mode_never_queries_the_slot_tables(self) -> None:
        session = _FakeSession(config=_config(mode=MapVetoMode.POOL, map_pool=[11, 12, 13, 14, 15]))

        await ensure_veto_session(session, _encounter(best_of=3))

        self.assertEqual(0, session.slot_queries)

    async def test_a_flat_config_is_never_refused_for_a_slot_reason(self) -> None:
        # ``best_of`` far above any slot count: the reconciliation must not
        # reach a config that has no slots to reconcile.
        session = _FakeSession(config=_config(mode=MapVetoMode.POOL, map_pool=[11, 12, 13]))

        veto = await ensure_veto_session(session, _encounter(best_of=9))

        self.assertIsNotNone(veto)

    async def test_an_existing_pool_is_never_overwritten_by_the_config(self) -> None:
        # The admin pool escape hatch's whole point, and the mechanism its
        # docstring rested on: a pool that
        # already exists is left alone, so a slot-mode config would size a
        # sequence for slots while the pool stayed the admin's. Slot mode can no
        # longer reach this state (that route 409s), which is why the coverage
        # lives here, in the mode where a pre-existing pool is legitimate.
        #
        # ``pool_count`` is 4 against a 5-map config on purpose: the two counts
        # must disagree for either half to be visible. A copy that happened
        # anyway shows up in the rows, and ``pool_size = pool_count or
        # len(config.map_pool)`` shows up in the sequence, which is sized from
        # the pool that will actually be drawn from -- 4 maps buys one opening
        # ban where 5 buys two.
        session = _FakeSession(config=_config(mode=MapVetoMode.POOL, map_pool=[11, 12, 13, 14, 15]), pool_count=4)

        veto = await ensure_veto_session(session, _encounter(best_of=3))

        self.assertEqual([], session.pool_rows)
        self.assertEqual(["ban_home", "pick_home", "pick_away", "decider"], veto.resolved_sequence_json)


class UnavailableReasonTests(IsolatedAsyncioTestCase):
    """One distinct reason per cause -- a later task needs distinct copy."""

    async def test_unknown_teams_short_circuit_before_any_query(self) -> None:
        session = _FakeSession()

        self.assertEqual(REASON_TEAMS_UNKNOWN, await unavailable_reason(session, _encounter(best_of=3, away=None)))

    async def test_no_config_is_not_configured(self) -> None:
        session = _FakeSession(config=None)

        self.assertEqual(REASON_NOT_CONFIGURED, await unavailable_reason(session, _encounter(best_of=3)))

    async def test_a_playable_flat_config_reports_not_configured(self) -> None:
        # Unreachable in practice (a session would exist); pinned so a slot
        # reason can never leak onto a flat config.
        session = _FakeSession(config=_config(mode=MapVetoMode.POOL, map_pool=[11, 12, 13]))

        self.assertEqual(REASON_NOT_CONFIGURED, await unavailable_reason(session, _encounter(best_of=9)))

    async def test_more_maps_than_slots_is_slot_count_mismatch(self) -> None:
        session = _FakeSession(config=_config(), slot_rows=[_slot(1, [11, 12]), _slot(3, [21, 22, 23])])

        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, await unavailable_reason(session, _encounter(best_of=3)))

    async def test_an_underfilled_slot_in_play_is_slot_underfilled(self) -> None:
        session = _FakeSession(config=_config(), slot_rows=[_slot(1, [11, 12]), _slot(3, [21])])

        self.assertEqual(REASON_SLOT_UNDERFILLED, await unavailable_reason(session, _encounter(best_of=2)))

    async def test_a_config_with_no_slots_is_slot_count_mismatch(self) -> None:
        # Both refusals reach the room through the same ``_slot_plan``, so the
        # empty-config guard has to name a reason here too, not just decline to
        # create.
        session = _FakeSession(config=_config(), slot_rows=[])

        self.assertEqual(REASON_SLOT_COUNT_MISMATCH, await unavailable_reason(session, _encounter(best_of=0)))

    async def test_an_underfilled_slot_out_of_play_is_not_a_reason(self) -> None:
        # The ordering pin on this side of ``_slot_plan``: slot 5 is beyond
        # ``best_of=2``, so the floor must not see it. Checking before truncation
        # would report ``slot_underfilled`` for a config the bracket can play, and
        # the room would tell a captain their config is broken when it is not.
        rows = [_slot(1, [11, 12]), _slot(3, [21, 22, 23]), _slot(5, [31])]
        session = _FakeSession(config=_config(), slot_rows=rows)

        self.assertEqual(REASON_NOT_CONFIGURED, await unavailable_reason(session, _encounter(best_of=2)))

    async def test_the_two_slot_reasons_are_distinct_strings(self) -> None:
        self.assertNotEqual(REASON_SLOT_COUNT_MISMATCH, REASON_SLOT_UNDERFILLED)
        self.assertNotIn(REASON_SLOT_COUNT_MISMATCH, {REASON_NOT_CONFIGURED, REASON_TEAMS_UNKNOWN})
        self.assertNotIn(REASON_SLOT_UNDERFILLED, {REASON_NOT_CONFIGURED, REASON_TEAMS_UNKNOWN})
