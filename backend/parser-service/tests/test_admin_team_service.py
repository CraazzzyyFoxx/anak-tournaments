from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

admin_schemas = importlib.import_module("src.schemas.admin.team")
admin_team_service = importlib.import_module("src.services.admin.team")


class AdminTeamServiceTests(IsolatedAsyncioTestCase):
    async def test_create_team_defaults_balancer_name_to_name_when_omitted(self) -> None:
        tournament_result = Mock()
        tournament_result.scalar_one_or_none.return_value = SimpleNamespace(id=68)
        captain_result = Mock()
        captain_result.scalar_one_or_none.return_value = SimpleNamespace(id=1)
        session = SimpleNamespace(
            execute=AsyncMock(side_effect=[tournament_result, captain_result]),
            add=Mock(side_effect=lambda team: setattr(team, "id", 1977)),
            commit=AsyncMock(),
        )
        data = admin_schemas.TeamCreate(
            name="Test 1",
            tournament_id=68,
            captain_id=1,
        )

        with patch.object(admin_team_service, "get_team", AsyncMock(return_value="created")):
            result = await admin_team_service.create_team(session, data)

        self.assertEqual("created", result)
        created_team = session.add.call_args.args[0]
        self.assertEqual("Test 1", created_team.balancer_name)
        session.commit.assert_awaited_once_with()

    async def test_update_team_defaults_null_balancer_name_to_current_name(self) -> None:
        team = SimpleNamespace(
            id=1977,
            name="Test 1",
            balancer_name="Old balancer name",
            players=[],
        )
        result = Mock()
        result.scalar_one_or_none.return_value = team
        session = SimpleNamespace(
            execute=AsyncMock(return_value=result),
            commit=AsyncMock(),
        )
        data = admin_schemas.TeamUpdate(balancer_name=None)

        with patch.object(admin_team_service, "get_team", AsyncMock(return_value=team)):
            updated_team = await admin_team_service.update_team(session, 1977, data)

        self.assertIs(team, updated_team)
        self.assertEqual("Test 1", team.balancer_name)
        session.commit.assert_awaited_once_with()
