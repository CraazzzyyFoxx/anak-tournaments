from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"

from src.services.encounter import service  # noqa: E402


class EncounterLoadOptionTests(TestCase):
    def test_stage_load_options_stay_summary_only(self) -> None:
        """A stage-scoped read loads the seats, never a whole stage tree.

        The encounter has no ``stage``/``stage_item`` relationship any more --
        its position lives in ``tournament.bracket_encounter`` (D22) and is
        resolved per row -- so what this guards is the other half of the rule it
        always guarded: the eager load must not drag a stage's items and their
        inputs behind every encounter of a list.
        """
        paths = "\n".join(
            str(getattr(option, "path", "")) for option in service.encounter_entities(["stage", "stage_item"])
        )

        self.assertIn("Encounter.teams", paths)
        self.assertNotIn("Stage.items", paths)
        self.assertNotIn("StageItem.inputs", paths)
