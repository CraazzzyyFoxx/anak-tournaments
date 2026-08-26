from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))


swiss_auto_round = importlib.import_module("src.services.standings.swiss_auto_round")


class SwissAutoRoundTests(TestCase):
    def test_stage_allows_round_up_to_configured_maximum(self) -> None:
        stage = SimpleNamespace(max_rounds=3)

        self.assertTrue(swiss_auto_round.stage_allows_next_round(stage, 3))
        self.assertFalse(swiss_auto_round.stage_allows_next_round(stage, 4))
