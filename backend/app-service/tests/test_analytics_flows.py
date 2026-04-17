from __future__ import annotations

import importlib
import os
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

analytics_flows = importlib.import_module("src.services.analytics.flows")


class _Dumpable:
    def __init__(self, payload: dict):
        self._payload = payload

    def model_dump(self, **kwargs: object) -> dict:
        output = dict(self._payload)
        exclude = kwargs.get("exclude")
        if isinstance(exclude, set):
            for key in exclude:
                output.pop(key, None)
        return output


class AnalyticsFlowsTests(IsolatedAsyncioTestCase):
    async def test_get_analytics_serializes_confidence_fields(self) -> None:
        session = SimpleNamespace()
        algorithm = SimpleNamespace(id=11)
        team = SimpleNamespace(id=99, avg_sr=2000, placement=1, name="Alpha", group=None)
        player = SimpleNamespace(id=42, team_id=99, tournament_id=7)
        analytics = SimpleNamespace(shift_one=100, shift_two=50, wins=4, shift=0)
        shift = SimpleNamespace(
            shift=1.25,
            confidence=0.82,
            effective_evidence=2.4,
            sample_tournaments=4,
            sample_matches=9,
            log_coverage=0.5,
        )

        team_payload = {
            "id": 99,
            "name": "Alpha",
            "avg_sr": 2000,
            "total_sr": 10000,
            "tournament_id": 7,
            "captain_id": 1,
            "tournament": None,
            "players": [],
            "captain": None,
            "placement": 1,
            "group": None,
        }
        player_payload = {
            "id": 42,
            "name": "Player",
            "sub_role": "hitscan",
            "rank": 2200,
            "division": 6,
            "role": "Damage",
            "tournament_id": 7,
            "user_id": 8,
            "team_id": 99,
            "is_newcomer": False,
            "is_newcomer_role": False,
            "is_substitution": False,
            "related_player_id": None,
            "tournament": None,
            "team": None,
            "user": None,
        }

        with (
            patch.object(analytics_flows.service, "get_algorithm", AsyncMock(return_value=algorithm)),
            patch.object(analytics_flows.service, "get_analytics", AsyncMock(return_value=[(team, player, shift, analytics)])),
            patch.object(analytics_flows.team_flows, "to_pydantic", AsyncMock(return_value=_Dumpable(team_payload))),
            patch.object(
                analytics_flows.team_flows,
                "to_pydantic_player",
                AsyncMock(return_value=_Dumpable(player_payload)),
            ),
            patch.object(analytics_flows, "get_division_grid", AsyncMock(return_value=None)),
        ):
            result = await analytics_flows.get_analytics(session, tournament_id=7, algorithm_id=11)

        serialized_player = result.teams[0].players[0]
        self.assertEqual(0.82, serialized_player.confidence)
        self.assertEqual(2.4, serialized_player.effective_evidence)
        self.assertEqual(4, serialized_player.sample_tournaments)
        self.assertEqual(9, serialized_player.sample_matches)
        self.assertEqual(0.5, serialized_player.log_coverage)
