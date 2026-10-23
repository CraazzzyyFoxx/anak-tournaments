from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import pandas as pd

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "analytics-service"))


device = importlib.import_module("src.services.ml.device")
from tests.ow_analytics import module as ow_module  # noqa: E402

standings_v2 = ow_module("models.standings_v2")
performance_v2 = ow_module("models.performance_v2")


class MLTrainingDeviceTests(TestCase):
    def test_auto_tries_gpu_backends_before_cpu(self) -> None:
        with (
            patch.object(device.settings, "ml_train_device", "auto"),
            patch.object(device.settings, "ml_gpu_fallback", True),
        ):
            self.assertEqual(("cuda", "gpu", "cpu"), device.lightgbm_devices())
            self.assertEqual(("cuda", "cpu"), device.xgboost_devices())

    def test_explicit_cuda_without_fallback_is_strict(self) -> None:
        with (
            patch.object(device.settings, "ml_train_device", "cuda"),
            patch.object(device.settings, "ml_gpu_fallback", False),
        ):
            self.assertEqual(("cuda",), device.lightgbm_devices())
            self.assertEqual(("cuda",), device.xgboost_devices())

    def test_cpu_device_disables_gpu_candidates(self) -> None:
        with (
            patch.object(device.settings, "ml_train_device", "cpu"),
            patch.object(device.settings, "ml_gpu_fallback", True),
        ):
            self.assertEqual(("cpu",), device.lightgbm_devices())
            self.assertEqual(("cpu",), device.xgboost_devices())

    def test_lightgbm_gpu_uses_smaller_max_bin(self) -> None:
        self.assertEqual({"device_type": "cpu"}, performance_v2._lightgbm_params("cpu"))
        self.assertEqual(
            {"device_type": "cuda", "max_bin": 63},
            performance_v2._lightgbm_params("cuda"),
        )

    def test_xgboost_gpu_uses_modern_cuda_device_param(self) -> None:
        self.assertEqual(
            {"tree_method": "hist", "device": "cpu"},
            standings_v2._xgboost_params("cpu"),
        )
        self.assertEqual(
            {"tree_method": "hist", "device": "cuda"},
            standings_v2._xgboost_params("cuda"),
        )

    def test_standings_training_falls_back_to_cpu_after_cuda_failure(self) -> None:
        with patch.object(
            standings_v2,
            "_train_standings_v2_with_device",
            side_effect=[RuntimeError("no cuda"), "trained"],
        ) as train:
            result = standings_v2.train_standings_v2(pd.DataFrame(), devices=("cuda", "cpu"))

        self.assertEqual("trained", result)
        self.assertEqual("cuda", train.call_args_list[0].kwargs["device"])
        self.assertEqual("cpu", train.call_args_list[1].kwargs["device"])

    def test_performance_training_uses_the_supplied_candidates_in_order(self) -> None:
        with patch.object(
            performance_v2,
            "_train_performance_v2_with_device",
            side_effect=[RuntimeError("no cuda"), RuntimeError("no opencl"), "trained"],
        ) as train:
            result = performance_v2.train_performance_v2(pd.DataFrame(), role="tank", devices=("cuda", "gpu", "cpu"))

        self.assertEqual("trained", result)
        self.assertEqual(["cuda", "gpu", "cpu"], [call.kwargs["device"] for call in train.call_args_list])

    def test_a_cpu_failure_is_final_and_a_strict_gpu_failure_is_reraised(self) -> None:
        with patch.object(
            performance_v2, "_train_performance_v2_with_device", side_effect=ValueError("no rows")
        ) as train:
            with self.assertRaisesRegex(ValueError, "no rows"):
                performance_v2.train_performance_v2(pd.DataFrame(), role="tank", devices=("cpu", "cuda"))
        self.assertEqual(1, train.call_count)

        with patch.object(standings_v2, "_train_standings_v2_with_device", side_effect=RuntimeError("no cuda")):
            with self.assertRaisesRegex(RuntimeError, "no cuda"):
                standings_v2.train_standings_v2(pd.DataFrame(), devices=("cuda",))

    def test_no_candidates_is_an_error_not_a_cpu_substitute(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "no XGBoost training devices"):
            standings_v2.train_standings_v2(pd.DataFrame(), devices=())
        with self.assertRaisesRegex(RuntimeError, "no LightGBM training devices"):
            performance_v2.train_performance_v2(pd.DataFrame(), role="tank", devices=())
