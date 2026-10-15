"""D89: only a superuser enables disciplines; the list holds known codes."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from shared.core.errors import BaseAPIException
from src import schemas
from src.services.workspace import registry


def _payload(**fields) -> schemas.WorkspaceUpdate:
    return schemas.WorkspaceUpdate(**fields)


class EnabledDisciplinesTests(IsolatedAsyncioTestCase):
    async def test_only_a_superuser_changes_the_enabled_disciplines(self) -> None:
        with (
            patch.object(registry, "actor", return_value=SimpleNamespace(is_superuser=False)),
            patch.object(registry.workspace_service, "get_by_id", AsyncMock(return_value=SimpleNamespace(id=1))),
            patch.object(registry.workspace_service, "update", AsyncMock()) as update,
        ):
            with self.assertRaises(BaseAPIException) as raised:
                await registry._svc_update(AsyncMock(), 1, _payload(disciplines_enabled=["overwatch", "lol"]), {})
        assert raised.exception.status_code == 403
        update.assert_not_awaited()

    async def test_a_superuser_enables_lol(self) -> None:
        workspace = SimpleNamespace(id=1)
        with (
            patch.object(registry, "actor", return_value=SimpleNamespace(is_superuser=True)),
            patch.object(registry.workspace_service, "get_by_id", AsyncMock(return_value=workspace)),
            patch.object(registry.workspace_service, "update", AsyncMock(return_value=workspace)) as update,
        ):
            await registry._svc_update(AsyncMock(), 1, _payload(disciplines_enabled=["overwatch", "lol", "lol"]), {})
        assert update.await_args.args[2] == {"disciplines_enabled": ["overwatch", "lol"]}


@pytest.mark.parametrize("codes", [["chess"], None])
def test_invalid_disciplines_are_rejected_by_the_schema(codes) -> None:
    with pytest.raises(ValidationError):
        _payload(disciplines_enabled=codes)
