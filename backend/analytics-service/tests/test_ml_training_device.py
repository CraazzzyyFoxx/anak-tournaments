from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import pandas as pd

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "analytics-service"))

os.environ["DEBUG"] = "false"

device = importlib.import_module("src.services.ml.device")
standings_v2 = importlib.import_module("src.services.ml.models.standings_v2")


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
        self.assertEqual({"device_type": "cpu"}, device.lightgbm_params("cpu"))
        self.assertEqual(
            {"device_type": "cuda", "max_bin": 63},
            device.lightgbm_params("cuda"),
        )

    def test_xgboost_gpu_uses_modern_cuda_device_param(self) -> None:
        self.assertEqual(
            {"tree_method": "hist", "device": "cpu"},
            device.xgboost_params("cpu"),
        )
        self.assertEqual(
            {"tree_method": "hist", "device": "cuda"},
            device.xgboost_params("cuda"),
        )

    def test_standings_training_falls_back_to_cpu_after_cuda_failure(self) -> None:
        with (
            patch.object(standings_v2, "xgboost_devices", return_value=("cuda", "cpu")),
            patch.object(
                standings_v2,
                "_train_standings_v2_with_device",
                side_effect=[RuntimeError("no cuda"), "trained"],
            ) as train,
        ):
            result = standings_v2.train_standings_v2(pd.DataFrame())

        self.assertEqual("trained", result)
        self.assertEqual("cuda", train.call_args_list[0].kwargs["device"])
        self.assertEqual("cpu", train.call_args_list[1].kwargs["device"])
