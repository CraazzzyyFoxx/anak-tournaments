import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.rpc.workspaces import register

_IDENTITY = {"user_id": 1, "is_superuser": True, "is_active": True}


def _register(fake_broker):
    registered: dict[str, object] = {}

    def fake_sub(topic):
        def dec(fn):
            registered[topic] = fn
            return fn

        return dec

    fake_broker.subscriber = fake_sub
    register(fake_broker, MagicMock())
    return registered


class WorkspaceMembersListRPCTests(IsolatedAsyncioTestCase):
    """Regression for OWT-TOURNAMENTS-242.

    ``sort not in workspace_service.MEMBERS_SORT_FIELDS`` read the sort
    allow-list off the ``WorkspaceService`` *instance*, but the constant only
    ever lived at module scope -- every call raised ``AttributeError``
    regardless of the requested sort value.
    """

    async def _call(self, data: dict) -> dict:
        fake_broker = MagicMock()
        handler = _register(fake_broker)["rpc.app.workspaces.members_list"]
        with (
            patch("src.rpc.workspaces.ensure_workspace_permission", MagicMock()),
            patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=MagicMock(id=1))),
            patch("src.rpc.workspaces.workspace_service.list_members_page", AsyncMock(return_value=(0, []))),
        ):
            return await handler(data, MagicMock())

    async def test_default_sort_does_not_crash(self) -> None:
        result = await self._call({"workspace_id": 1, "identity": _IDENTITY})
        self.assertNotIn("error", result)
        self.assertEqual(result["data"]["total"], 0)

    async def test_unknown_sort_falls_back_to_username(self) -> None:
        page = AsyncMock(return_value=(0, []))
        with (
            patch("src.rpc.workspaces.ensure_workspace_permission", MagicMock()),
            patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=MagicMock(id=1))),
            patch("src.rpc.workspaces.workspace_service.list_members_page", page),
        ):
            fake_broker = MagicMock()
            handler = _register(fake_broker)["rpc.app.workspaces.members_list"]
            result = await handler(
                {"workspace_id": 1, "identity": _IDENTITY, "query": {"sort": ["bogus"]}}, MagicMock()
            )
        self.assertNotIn("error", result)
        self.assertEqual(page.call_args.kwargs["sort"], "username")
