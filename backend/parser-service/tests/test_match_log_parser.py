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

    def test_quoted_commas_and_type_index_survive_batched_csv_parse(self) -> None:
        tournament = SimpleNamespace(id=1, name="Test Cup")
        lines = [
            "2026-04-19T12:00:00Z,meta,0,ignored",
            '2026-04-19T12:00:00Z,match_start,0.0,Ilios,"Control","Team, A","Team, B"',
            "2026-04-19T12:00:00Z,not_a_real_event,1.0,x",
            "2026-04-19T12:00:00Z,kill,12.5,Team A,Ana,Ana,Team B,Mercy,Mercy,0,100,False,False",
        ]
        processor = flows.MatchLogProcessor(tournament, "match.log", lines, SimpleNamespace())

        starts = processor._get_rows(enums.LogEventType.MatchStart)
        self.assertEqual(1, len(starts))
        self.assertEqual(["Ilios", "Control", "Team, A", "Team, B"], starts.iloc[0]["data"])
        self.assertEqual(1, len(processor._get_rows(enums.LogEventType.Kill)))
        self.assertTrue(processor._get_rows(enums.LogEventType.PlayerStat).empty)
