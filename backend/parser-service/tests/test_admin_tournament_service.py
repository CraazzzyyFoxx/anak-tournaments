from __future__ import annotations

import importlib
import os
import sys
from datetime import date
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

admin_schemas = importlib.import_module("src.schemas.admin.tournament")
admin_tournament_service = importlib.import_module("src.services.admin.tournament")
models = importlib.import_module("src.models")


class AdminTournamentServiceTests(IsolatedAsyncioTestCase):
    async def test_create_uses_workspace_default_division_grid_version_when_missing(self) -> None:
        existing_result = Mock()
        existing_result.scalar_one_or_none.return_value = None

        session = SimpleNamespace(
            execute=AsyncMock(return_value=existing_result),
            scalar=AsyncMock(return_value=None),
            add=Mock(side_effect=lambda tournament: setattr(tournament, "id", 123)),
            commit=AsyncMock(),
        )
        data = admin_schemas.TournamentCreate(
            workspace_id=10,
            number=4,
            name="Test",
            is_league=False,
            start_date=date(2026, 4, 17),
            end_date=date(2026, 4, 18),
        )

        with (
            patch.object(
                admin_tournament_service,
                "get_workspace_division_grid_version_id",
                AsyncMock(return_value=77),
            ) as get_default_version,
            patch.object(
                admin_tournament_service,
                "get_tournament",
                AsyncMock(return_value="created"),
            ) as get_tournament,
            patch.object(
                admin_tournament_service.division_grid_cache,
                "invalidate_tournament",
                AsyncMock(),
            ) as invalidate_tournament,
            patch.object(
                admin_tournament_service.division_grid_cache,
                "invalidate_workspace",
                AsyncMock(),
            ) as invalidate_workspace,
        ):
            result = await admin_tournament_service.create_tournament(session, data)

        self.assertEqual("created", result)
        created_tournament = session.add.call_args.args[0]
        self.assertEqual(77, created_tournament.division_grid_version_id)
        get_default_version.assert_awaited_once_with(session, 10)
        session.commit.assert_awaited_once_with()
        invalidate_tournament.assert_awaited_once_with(123)
        invalidate_workspace.assert_awaited_once_with(10)
        get_tournament.assert_awaited_once_with(session, 123)

    async def test_update_uses_workspace_default_division_grid_version_when_null_requested(self) -> None:
        tournament = models.Tournament(
            workspace_id=10,
            number=4,
            name="Test",
            is_league=False,
            start_date=date(2026, 4, 17),
            end_date=date(2026, 4, 18),
            division_grid_version_id=55,
        )
        tournament.id = 123

        result = Mock()
        result.scalar_one_or_none.return_value = tournament
        session = SimpleNamespace(
            execute=AsyncMock(return_value=result),
            scalar=AsyncMock(return_value=None),
            commit=AsyncMock(),
        )
        data = admin_schemas.TournamentUpdate(division_grid_version_id=None)

        with (
            patch.object(
                admin_tournament_service,
                "get_workspace_division_grid_version_id",
                AsyncMock(return_value=77),
            ) as get_default_version,
            patch.object(
                admin_tournament_service,
                "get_tournament",
                AsyncMock(return_value=tournament),
            ) as get_tournament,
            patch.object(
                admin_tournament_service.division_grid_cache,
                "invalidate_tournament",
                AsyncMock(),
            ) as invalidate_tournament,
            patch.object(
                admin_tournament_service.division_grid_cache,
                "invalidate_workspace",
                AsyncMock(),
            ) as invalidate_workspace,
        ):
            result = await admin_tournament_service.update_tournament(session, 123, data)

        self.assertIs(result, tournament)
        self.assertEqual(77, tournament.division_grid_version_id)
        get_default_version.assert_awaited_once_with(session, 10)
        session.commit.assert_awaited_once_with()
        invalidate_tournament.assert_awaited_once_with(123)
        invalidate_workspace.assert_awaited_once_with(10)
        get_tournament.assert_awaited_once_with(session, 123)
