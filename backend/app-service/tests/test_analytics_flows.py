from __future__ import annotations

import importlib
import os
from datetime import datetime, timezone
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
            "tournament": {
                "id": 7,
                "created_at": None,
                "updated_at": None,
                "workspace_id": 1,
                "name": "Tournament 7",
                "start_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "end_date": datetime(2026, 1, 2, tzinfo=timezone.utc),
                "number": 7,
                "description": None,
                "challonge_id": None,
                "challonge_slug": None,
                "is_league": False,
                "is_finished": False,
                "status": "live",
                "registration_opens_at": None,
                "registration_closes_at": None,
                "check_in_opens_at": None,
                "check_in_closes_at": None,
                "win_points": 0,
                "draw_points": 0,
                "loss_points": 0,
                "stages": [],
                "participants_count": None,
                "registrations_count": None,
                "division_grid_version_id": 77,
                "division_grid_version": {
                    "id": 77,
                    "created_at": None,
                    "updated_at": None,
                    "grid_id": 10,
                    "version": 3,
                    "label": "Custom grid",
                    "status": "published",
                    "created_from_version_id": None,
                    "published_at": None,
                    "tiers": [
                        {
                            "id": 701,
                            "version_id": 77,
                            "slug": "division-6",
                            "number": 6,
                            "name": "Division 6",
                            "sort_order": 6,
                            "rank_min": 1400,
                            "rank_max": 1499,
                            "icon_url": "/custom-division-6.png",
                        }
                    ],
                },
            },
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
        self.assertEqual(
            "/custom-division-6.png",
            result.teams[0].tournament.division_grid_version.tiers[0].icon_url,
        )
        self.assertEqual(0.82, serialized_player.confidence)
        self.assertEqual(2.4, serialized_player.effective_evidence)
        self.assertEqual(4, serialized_player.sample_tournaments)
        self.assertEqual(9, serialized_player.sample_matches)
        self.assertEqual(0.5, serialized_player.log_coverage)

    async def test_get_analytics_uses_best_positive_team_placement(self) -> None:
        session = SimpleNamespace()
        algorithm = SimpleNamespace(id=11)
        team = SimpleNamespace(
            id=99,
            name="Alpha",
            avg_sr=2000,
            total_sr=10000,
            tournament_id=7,
            captain_id=1,
            standings=[
                SimpleNamespace(overall_position=0, group=None),
                SimpleNamespace(overall_position=2, group=None),
            ],
        )
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
            "placement": 2,
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

        self.assertEqual(2, result.teams[0].placement)

    async def test_get_analytics_passes_workspace_scope_to_service_layer(self) -> None:
        session = SimpleNamespace()
        algorithm = SimpleNamespace(id=11)

        with (
            patch.object(
                analytics_flows.service,
                "get_algorithm",
                AsyncMock(return_value=algorithm),
            ),
            patch.object(
                analytics_flows.service,
                "get_analytics",
                AsyncMock(return_value=[]),
            ) as get_analytics,
            patch.object(analytics_flows, "get_division_grid", AsyncMock(return_value=None)),
        ):
            await analytics_flows.get_analytics(
                session,
                tournament_id=7,
                algorithm_id=11,
                workspace_id=5,
            )

        get_analytics.assert_awaited_once_with(session, 7, algorithm, workspace_id=5)
