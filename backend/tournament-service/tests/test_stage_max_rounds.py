from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))


schemas = importlib.import_module("src.schemas")
enums = importlib.import_module("shared.core.enums")


class StageMaxRoundsTests(TestCase):
    def test_stage_create_defaults_max_rounds_to_five(self) -> None:
        data = schemas.StageCreate(
            name="Swiss",
            stage_type=enums.StageType.SWISS,
        )

        self.assertEqual(5, data.max_rounds)
