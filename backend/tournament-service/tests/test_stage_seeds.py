"""Seed ranking and bracket-policy helpers."""

from __future__ import annotations

import importlib
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

seeds = importlib.import_module("src.domain.stage.seeds")
enums = importlib.import_module("shared.core.enums")


def _team(team_id: int, avg_sr: float = 0.0, total_sr: int = 0) -> SimpleNamespace:
    return SimpleNamespace(id=team_id, avg_sr=avg_sr, total_sr=total_sr)


class ParseSeedRankingTests(TestCase):
    def test_missing_and_garbage_fall_back_to_slot(self) -> None:
        for raw in (None, {}, {"seed_ranking": None}, {"seed_ranking": "elo"}, {"seed_ranking": 1}):
            self.assertEqual(seeds.parse_seed_ranking(raw), seeds.SeedRanking.SLOT)

    def test_reads_known_values(self) -> None:
        self.assertEqual(seeds.parse_seed_ranking({"seed_ranking": "avg_sr"}), seeds.SeedRanking.AVG_SR)
        self.assertEqual(seeds.parse_seed_ranking({"seed_ranking": "random"}), seeds.SeedRanking.RANDOM)


class RankTeamIdsTests(TestCase):
    def test_avg_sr_highest_is_seed_one(self) -> None:
        teams = [_team(1, 2200), _team(2, 3100), _team(3, 2800)]
        self.assertEqual(seeds.rank_team_ids(teams, seeds.SeedRanking.AVG_SR, rng_seed=0), [2, 3, 1])

    def test_avg_sr_ties_break_on_lower_id(self) -> None:
        teams = [_team(8, 3000), _team(3, 3000), _team(5, 2500)]
        self.assertEqual(seeds.rank_team_ids(teams, seeds.SeedRanking.AVG_SR, rng_seed=0), [3, 8, 5])

    def test_total_sr(self) -> None:
        teams = [_team(1, total_sr=10_000), _team(2, total_sr=18_000)]
        self.assertEqual(seeds.rank_team_ids(teams, seeds.SeedRanking.TOTAL_SR, rng_seed=0), [2, 1])

    def test_slot_keeps_given_order(self) -> None:
        teams = [_team(9, 1000), _team(2, 4000)]
        self.assertEqual(seeds.rank_team_ids(teams, seeds.SeedRanking.SLOT, rng_seed=0), [9, 2])

    def test_random_is_stable_for_the_same_seed(self) -> None:
        teams = [_team(i, float(i)) for i in range(1, 9)]
        first = seeds.rank_team_ids(teams, seeds.SeedRanking.RANDOM, rng_seed=42)
        second = seeds.rank_team_ids(teams, seeds.SeedRanking.RANDOM, rng_seed=42)
        other = seeds.rank_team_ids(teams, seeds.SeedRanking.RANDOM, rng_seed=43)
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertEqual(sorted(first), [1, 2, 3, 4, 5, 6, 7, 8])

    def test_apply_leaves_placeholders_and_unknown_ids_alone(self) -> None:
        teams = {1: _team(1, 3000)}
        self.assertEqual(
            seeds.apply_seed_ranking([-1, -2], teams, seeds.SeedRanking.AVG_SR, rng_seed=1),
            [-1, -2],
        )
        self.assertEqual(
            seeds.apply_seed_ranking([1, 99], teams, seeds.SeedRanking.AVG_SR, rng_seed=1),
            [1, 99],
        )


class BracketPolicyTests(TestCase):
    def test_advance_split_sends_odd_extra_to_upper(self) -> None:
        stage = SimpleNamespace(
            stage_type=enums.StageType.DOUBLE_ELIMINATION,
            split_lower_bracket=True,
            items=[SimpleNamespace(type=enums.StageItemType.BRACKET_LOWER)],
        )
        self.assertEqual(seeds.advance_split(stage, 3), (2, 1))

    def test_advance_split_single_bracket_de_keeps_everyone_upper(self) -> None:
        stage = SimpleNamespace(
            stage_type=enums.StageType.DOUBLE_ELIMINATION,
            split_lower_bracket=True,
            items=[SimpleNamespace(type=enums.StageItemType.SINGLE_BRACKET)],
        )
        self.assertEqual(seeds.advance_split(stage, 4), (4, 0))


class StageLifecycleTests(TestCase):
    def test_draft_preview_live_done(self) -> None:
        lifecycle = importlib.import_module("src.domain.stage.lifecycle")
        draft = SimpleNamespace(is_active=False, is_published=False, is_completed=False)
        self.assertEqual(lifecycle.stage_lifecycle(draft, has_encounters=False), lifecycle.StageLifecycle.DRAFT)
        self.assertEqual(lifecycle.stage_lifecycle(draft, has_encounters=True), lifecycle.StageLifecycle.PREVIEW)
        live = SimpleNamespace(is_active=False, is_published=True, is_completed=False)
        self.assertEqual(lifecycle.stage_lifecycle(live, has_encounters=True), lifecycle.StageLifecycle.LIVE)
        done = SimpleNamespace(is_active=False, is_published=True, is_completed=True)
        self.assertEqual(lifecycle.stage_lifecycle(done, has_encounters=True), lifecycle.StageLifecycle.DONE)

