"""Roster synergy math + chronological split ordering.

Regression anchors:

- ids are NOT chronological (tournament 62 started 2025-07-19, 61 started
  2026-03-14) — ``TimeSeriesSplit.from_ids`` must respect the given order, not
  re-sort numerically;
- synergy is pair-based co-play, not team identity: teams are minted per
  tournament, players persist.
"""

from __future__ import annotations

import importlib
import math
import os
import sys
from pathlib import Path
from unittest import TestCase

import pandas as pd

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "analytics-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ["DEBUG"] = "false"
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

synergy = importlib.import_module("src.services.ml.features.synergy")
splits = importlib.import_module("src.services.ml.training.splits")


def _roster(rows: list[tuple[int, int]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["team_id", "uid"])


def _results(rows: list[tuple[int, int, int]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["team_id", "games", "wins"])


class SynergyMathTests(TestCase):
    def test_pair_share_and_weighted_winrate(self) -> None:
        # Target team 100: players 1,2,3 → pairs (1,2),(1,3),(2,3).
        # History: team 50 = {1,2} won 3/4; team 60 = {1,3} won 1/4.
        out = synergy._synergy_from_frames(
            _roster([(100, 1), (100, 2), (100, 3)]),
            _roster([(50, 1), (50, 2), (60, 1), (60, 3)]),
            _results([(50, 4, 3), (60, 4, 1)]),
        )

        row = out[out["team_id"] == 100].iloc[0]
        self.assertAlmostEqual(2 / 3, row["synergy_pairs"])
        # (3 + 1) wins over (4 + 4) games — weighted, not averaged per pair.
        self.assertAlmostEqual(0.5, row["synergy_winrate"])

    def test_pair_played_on_multiple_past_teams_accumulates(self) -> None:
        out = synergy._synergy_from_frames(
            _roster([(100, 1), (100, 2)]),
            _roster([(50, 1), (50, 2), (60, 1), (60, 2)]),
            _results([(50, 2, 2), (60, 6, 0)]),
        )
        row = out.iloc[0]
        self.assertEqual(1.0, row["synergy_pairs"])
        self.assertAlmostEqual(0.25, row["synergy_winrate"])

    def test_strangers_score_zero_pairs_and_missing_winrate(self) -> None:
        out = synergy._synergy_from_frames(
            _roster([(100, 1), (100, 2)]),
            _roster([(50, 3), (50, 4)]),
            _results([(50, 4, 4)]),
        )
        row = out.iloc[0]
        self.assertEqual(0.0, row["synergy_pairs"])
        # NaN, not 0.5: no history is missing data, not average experience.
        self.assertTrue(math.isnan(row["synergy_winrate"]))

    def test_past_team_without_decided_games_is_no_history(self) -> None:
        out = synergy._synergy_from_frames(
            _roster([(100, 1), (100, 2)]),
            _roster([(50, 1), (50, 2)]),
            _results([(50, 0, 0)]),
        )
        row = out.iloc[0]
        self.assertEqual(0.0, row["synergy_pairs"])
        self.assertTrue(math.isnan(row["synergy_winrate"]))


class ChronologicalSplitTests(TestCase):
    def test_from_ids_preserves_the_given_chronological_order(self) -> None:
        # 62 (Jul 2025) chronologically precedes 54 (Aug 2025) and 61 (Mar 2026)
        # despite its higher id. Sorting numerically would put 61 into val and
        # 62 AFTER it — training on the future.
        split = splits.TimeSeriesSplit.from_ids([62, 54, 61, 64], test_id=64)
        self.assertEqual((62, 54), split.train_ids)
        self.assertEqual(61, split.val_id)
        self.assertEqual(64, split.test_id)

    def test_from_ids_never_numerically_resorts(self) -> None:
        split = splits.TimeSeriesSplit.from_ids([10, 2, 7], test_id=7)
        self.assertEqual((10,), split.train_ids)
        self.assertEqual(2, split.val_id)
