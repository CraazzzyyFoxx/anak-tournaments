"""Standings v2 training: fold sizing, NaN handling, and the predictability feed.

Regression anchors for the 2026-08 accuracy audit:

- isotonic calibration folds were pinned to 2 forever (``len(set(y))`` counted
  the two distinct labels of a binary target, not the rows),
- ``fillna(0.0)`` fed unrated rosters ``mu = 0`` on a scale centred at ~25,
- Match Quality's ``predictability`` was neutral-50 everywhere because the
  feature frame never carries ``p_home_wins`` and nothing computed one.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import AsyncMock, patch

import numpy as np
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

standings_v2 = importlib.import_module("src.services.ml.models.standings_v2")
match_quality_runner = importlib.import_module("src.services.ml.inference.match_quality_runner")


def _synthetic_frame(n: int, *, seed: int = 0, nan_mu_share: float = 0.15) -> pd.DataFrame:
    """Balanced-teams shaped frame: rank gaps ~0, signal lives in the mu gap."""
    rng = np.random.default_rng(seed)
    home_mu = rng.normal(25.0, 2.0, n)
    away_mu = rng.normal(25.0, 2.0, n)
    mu_gap = home_mu - away_mu
    p = 1.0 / (1.0 + np.exp(-0.8 * mu_gap))
    frame = pd.DataFrame(
        {
            "home_avg_rank": rng.normal(2500.0, 30.0, n),
            "away_avg_rank": rng.normal(2500.0, 30.0, n),
            "home_std_rank": rng.uniform(0.0, 200.0, n),
            "away_std_rank": rng.uniform(0.0, 200.0, n),
            "home_avg_mu": home_mu,
            "away_avg_mu": away_mu,
            "home_max_mu": home_mu + rng.uniform(0.0, 4.0, n),
            "away_max_mu": away_mu + rng.uniform(0.0, 4.0, n),
            "home_std_mu": rng.uniform(0.0, 3.0, n),
            "away_std_mu": rng.uniform(0.0, 3.0, n),
            "home_won": (rng.random(n) < p).astype(float),
        }
    )
    frame["rank_gap"] = frame["home_avg_rank"] - frame["away_avg_rank"]
    frame["mu_gap"] = frame["home_avg_mu"] - frame["away_avg_mu"]
    frame["max_mu_gap"] = frame["home_max_mu"] - frame["away_max_mu"]
    # Unrated rosters: every mu-derived column missing, exactly as the frame
    # builder emits them for a first-time field.
    nan_rows = rng.random(n) < nan_mu_share
    mu_cols = [c for c in frame.columns if "mu" in c]
    frame.loc[nan_rows, mu_cols] = np.nan
    return frame


class CalibrationFoldTests(TestCase):
    def test_folds_scale_with_row_count_not_label_cardinality(self) -> None:
        # Binary labels used to pin this to 2 regardless of data volume.
        self.assertEqual(2, standings_v2._calibration_folds(100))
        self.assertEqual(2, standings_v2._calibration_folds(600))
        self.assertEqual(3, standings_v2._calibration_folds(800))
        self.assertEqual(5, standings_v2._calibration_folds(1250))
        self.assertEqual(5, standings_v2._calibration_folds(400_000))


class FeatureOrderTests(TestCase):
    def test_constant_at_inference_h2h_features_are_gone(self) -> None:
        order = standings_v2.STANDINGS_FEATURE_ORDER
        self.assertNotIn("h2h_winrate", order)
        self.assertNotIn("days_since_last_meet", order)

    def test_mu_spread_features_are_modelled(self) -> None:
        order = standings_v2.STANDINGS_FEATURE_ORDER
        for column in ("home_max_mu", "away_max_mu", "max_mu_gap", "home_std_mu", "away_std_mu"):
            self.assertIn(column, order)


class TrainStandingsV2Tests(TestCase):
    def test_trains_through_nan_and_reports_val_metrics(self) -> None:
        result = standings_v2.train_standings_v2(
            _synthetic_frame(800, seed=1),
            val_df=_synthetic_frame(200, seed=2),
        )

        self.assertEqual(list(standings_v2.STANDINGS_FEATURE_ORDER), result.model.feature_order)
        for key in ("logloss_train", "brier_train", "logloss_val", "brier_val", "n_rows"):
            self.assertIn(key, result.metrics, key)

        # NaN rows must predict, and predictions must be probabilities.
        probe = _synthetic_frame(64, seed=3, nan_mu_share=1.0)
        proba = result.model.predict_proba(probe)
        self.assertEqual(64, len(proba))
        self.assertTrue(np.all(np.isfinite(proba)))
        self.assertTrue(np.all((proba >= 0.0) & (proba <= 1.0)))

    def test_learns_the_mu_gap_direction(self) -> None:
        result = standings_v2.train_standings_v2(_synthetic_frame(1200, seed=4, nan_mu_share=0.0))

        probe = _synthetic_frame(400, seed=5, nan_mu_share=0.0)
        proba = result.model.predict_proba(probe)
        favored = proba[probe["mu_gap"].to_numpy() > 1.0]
        underdog = proba[probe["mu_gap"].to_numpy() < -1.0]
        self.assertGreater(float(favored.mean()), float(underdog.mean()))


class MatchQualityWinProbabilityTests(IsolatedAsyncioTestCase):
    """``predictability`` needs a real ``p_home_wins`` — neutral only without an artifact."""

    def _session(self, algorithm_id: int | None = 18) -> SimpleNamespace:
        return SimpleNamespace(scalar=AsyncMock(return_value=algorithm_id))

    async def test_no_algorithm_row_stays_neutral(self) -> None:
        p = await match_quality_runner._standings_win_probability(
            self._session(algorithm_id=None), pd.DataFrame({"encounter_id": [1]})
        )
        self.assertIsNone(p)

    async def test_active_artifact_yields_per_encounter_probabilities(self) -> None:
        encounters = _synthetic_frame(8, seed=6).assign(encounter_id=range(8))

        class _Stub:
            def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
                return np.full(len(df), 0.7)

        with (
            patch.object(
                match_quality_runner,
                "load_active_artifact",
                AsyncMock(return_value=SimpleNamespace(storage_uri="s3://x")),
            ),
            patch.object(match_quality_runner, "load_artifact", return_value=_Stub()),
        ):
            p = await match_quality_runner._standings_win_probability(self._session(), encounters)

        assert p is not None
        self.assertEqual(8, len(p))
        self.assertTrue((p == 0.7).all())

    async def test_missing_artifact_file_stays_neutral(self) -> None:
        with (
            patch.object(
                match_quality_runner,
                "load_active_artifact",
                AsyncMock(return_value=SimpleNamespace(storage_uri="s3://gone")),
            ),
            patch.object(match_quality_runner, "load_artifact", side_effect=FileNotFoundError),
        ):
            p = await match_quality_runner._standings_win_probability(
                self._session(), pd.DataFrame({"encounter_id": [1]})
            )
        self.assertIsNone(p)
