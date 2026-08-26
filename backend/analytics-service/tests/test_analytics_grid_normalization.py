from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))


analytics_flows = importlib.import_module("src.services.analytics.flows")


class AnalyticsGridNormalizationTests(TestCase):
    def test_division_delta_points_neutralizes_global_grid_shift(self) -> None:
        self.assertEqual(0, analytics_flows.division_delta_points(6, 6))
        self.assertEqual(100, analytics_flows.division_delta_points(6, 5))
        self.assertEqual(-100, analytics_flows.division_delta_points(5, 6))
        self.assertIsNone(analytics_flows.division_delta_points(None, 6))
