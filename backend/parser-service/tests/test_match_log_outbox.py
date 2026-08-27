from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

flows = importlib.import_module("src.services.match_logs.flows")
enums = importlib.import_module("src.core.enums")


class MatchLogOutboxTests(IsolatedAsyncioTestCase):
    async def test_match_log_events_enqueue_recalc_and_completed_event(self) -> None:
        session = object()
        encounter = SimpleNamespace(
            id=7,
            tournament_id=42,
            home_team_id=1,
            away_team_id=2,
            home_score=3,
            away_score=1,
            status=enums.EncounterStatus.COMPLETED,
            result_status=enums.EncounterResultStatus.NONE,
        )

        with patch.object(flows, "enqueue_outbox_event", AsyncMock()) as enqueue:
            await flows._enqueue_match_log_tournament_events(session, encounter)

        self.assertEqual(3, enqueue.await_count)
        changed_call, recalc_call, completed_call = enqueue.await_args_list
        self.assertIs(changed_call.args[0], session)
        self.assertEqual("tournament_changed", changed_call.args[1].event_type)
        self.assertEqual("bracket_changed", changed_call.args[1].reason)
        self.assertEqual("parser-service", changed_call.args[1].source_service)
        self.assertEqual("tournament.changed.42", changed_call.kwargs["routing_key"])
        self.assertIs(recalc_call.args[0], session)
        self.assertEqual("tournament_standings_invalidated", recalc_call.args[1].event_type)
        self.assertEqual("parser-service", recalc_call.args[1].source_service)
        self.assertEqual("tournament.standings.invalidated", recalc_call.kwargs["routing_key"])
        self.assertEqual("encounter_completed", completed_call.args[1].event_type)
        self.assertEqual(7, completed_call.args[1].encounter_id)
        self.assertEqual(1, completed_call.args[1].winner_team_id)
        self.assertEqual("tournament.encounter.completed", completed_call.kwargs["routing_key"])

    async def test_match_log_events_skip_completed_event_for_open_encounter(self) -> None:
        encounter = SimpleNamespace(
            id=7,
            tournament_id=42,
            home_team_id=1,
            away_team_id=2,
            home_score=0,
            away_score=0,
            status=enums.EncounterStatus.OPEN,
            result_status=enums.EncounterResultStatus.NONE,
        )

        with patch.object(flows, "enqueue_outbox_event", AsyncMock()) as enqueue:
            await flows._enqueue_match_log_tournament_events(object(), encounter)

        self.assertEqual(2, enqueue.await_count)
        changed_call, recalc_call = enqueue.await_args_list
        self.assertEqual("tournament_changed", changed_call.args[1].event_type)
        self.assertEqual("bracket_changed", changed_call.args[1].reason)
        self.assertEqual("tournament_standings_invalidated", recalc_call.args[1].event_type)
