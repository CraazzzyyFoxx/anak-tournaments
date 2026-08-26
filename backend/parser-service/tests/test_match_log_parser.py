from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

enums = importlib.import_module("src.core.enums")
flows = importlib.import_module("src.services.match_logs.flows")


class MatchLogParserTests(TestCase):
    def test_wide_player_stat_row_is_not_truncated_or_shifted(self) -> None:
        tournament = SimpleNamespace(id=1, name="Test Cup")
        stat_payload = [
            "1",
            "Blue Team",
            "Player One",
            "Ana",
            *[str(index) for index in range(33)],
        ]
        line = ",".join(["2026-04-19T12:00:00Z", "player_stat", "12.5", *stat_payload])

        processor = flows.MatchLogProcessor(tournament, "match.log", [line], SimpleNamespace())

        rows = processor._get_rows(enums.LogEventType.PlayerStat)
        self.assertEqual(1, len(rows))
        self.assertEqual(stat_payload, rows.iloc[0]["data"])
