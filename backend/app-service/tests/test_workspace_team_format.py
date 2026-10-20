"""The enabled-disciplines list is workspace-admin territory: normalised, never superuser-gated."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from src import schemas
from src.services.workspace import registry


def _payload(**fields) -> schemas.WorkspaceUpdate:
    return schemas.WorkspaceUpdate(**fields)


class EnabledDisciplinesTests(IsolatedAsyncioTestCase):
    async def test_a_workspace_admin_reorders_and_enables_disciplines(self) -> None:
        """No superuser check: ``workspace.update`` (the CRUD gate) is the whole permission.

        The list reaches the service deduplicated and in the order sent -- ``[0]`` is the
        default discipline, so the order is data.
        """
        workspace = SimpleNamespace(id=1)
        with (
            patch.object(registry.workspace_service, "get_by_id", AsyncMock(return_value=workspace)),
            patch.object(registry.workspace_service, "update", AsyncMock(return_value=workspace)) as update,
        ):
            await registry._svc_update(
                AsyncMock(),
                1,
                _payload(disciplines_enabled=["lol", "overwatch", "lol"]),
                {"identity": {"id": 7, "is_superuser": False}},
            )
        assert update.await_args.args[2] == {"disciplines_enabled": ["lol", "overwatch"]}


@pytest.mark.parametrize("codes", [["chess"], None, []])
def test_invalid_disciplines_are_rejected_by_the_schema(codes) -> None:
    with pytest.raises(ValidationError):
        _payload(disciplines_enabled=codes)
