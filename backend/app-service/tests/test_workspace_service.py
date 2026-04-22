from __future__ import annotations

import importlib
import os
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

workspace_service = importlib.import_module("src.services.workspace.service")


class WorkspaceServiceTests(IsolatedAsyncioTestCase):
    async def test_create_uses_system_default_division_grid_version_when_none_is_provided(self) -> None:
        session = SimpleNamespace(add=Mock(), flush=AsyncMock())

        with patch.object(
            workspace_service,
            "get_default_division_grid_version_id",
            AsyncMock(return_value=77),
        ) as get_default_version_id:
            workspace = await workspace_service.create(
                session,
                slug="homies-family",
                name="Homies Family",
                description=None,
                icon_url=None,
                default_division_grid_version_id=None,
            )

        self.assertEqual(77, workspace.default_division_grid_version_id)
        get_default_version_id.assert_awaited_once_with(session)
        session.add.assert_called_once_with(workspace)
        session.flush.assert_awaited_once()

    async def test_update_uses_system_default_division_grid_version_when_none_is_provided(self) -> None:
        session = SimpleNamespace(flush=AsyncMock())
        workspace = SimpleNamespace(
            id=4,
            default_division_grid_version_id=12,
            name="Homies Family",
            description=None,
            icon_url=None,
        )

        with (
            patch.object(
                workspace_service,
                "get_default_division_grid_version_id",
                AsyncMock(return_value=77),
            ) as get_default_version_id,
            patch.object(
                workspace_service.division_grid_cache,
                "invalidate_workspace",
                AsyncMock(),
            ) as invalidate_workspace,
        ):
            result = await workspace_service.update(
                session,
                workspace,
                {"default_division_grid_version_id": None},
            )

        self.assertIs(result, workspace)
        self.assertEqual(77, workspace.default_division_grid_version_id)
        get_default_version_id.assert_awaited_once_with(session)
        invalidate_workspace.assert_awaited_once_with(4)
        session.flush.assert_awaited_once()
