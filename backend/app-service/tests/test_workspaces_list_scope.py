"""``rpc.app.workspaces.list`` scope transport.

The service-level filtering is covered by ``WorkspaceGetAllVisibilityTests``
(``test_workspace_service.py``); this file only pins the transport contract the
frontend depends on: no ``scope`` means the strict public directory (so a
forgotten param can never widen the home page again), and an unknown scope is
rejected instead of silently falling back to the widest list.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.test_audit_workspace import _handler  # noqa: E402

_SUPERUSER = {"user_id": 42, "username": "kate", "is_active": True, "is_superuser": True}


class ListScopeRPCTests(IsolatedAsyncioTestCase):
    async def _call(self, data):
        handler = _handler(importlib.import_module("src.rpc.workspaces"), "rpc.app.workspaces.list")
        lister = AsyncMock(return_value=[])
        with patch("src.rpc.workspaces.workspace_service.get_all", lister):
            return await handler(data, MagicMock()), lister

    async def test_defaults_to_the_public_directory(self) -> None:
        envelope, lister = await self._call({})

        self.assertTrue(envelope["ok"])
        self.assertEqual("public", lister.await_args.kwargs["scope"])

    async def test_a_superuser_gets_no_wider_default(self) -> None:
        _envelope, lister = await self._call({"identity": _SUPERUSER})

        self.assertEqual("public", lister.await_args.kwargs["scope"])

    async def test_forwards_a_known_scope(self) -> None:
        for scope in ("public", "admin", "all"):
            with self.subTest(scope=scope):
                _envelope, lister = await self._call({"query": {"scope": [scope]}})

                self.assertEqual(scope, lister.await_args.kwargs["scope"])

    async def test_rejects_an_unknown_scope_without_listing_anything(self) -> None:
        envelope, lister = await self._call({"query": {"scope": ["everything"]}})

        self.assertEqual("unprocessable", envelope["error"]["code"])
        lister.assert_not_awaited()

    async def test_serializes_what_the_service_returns(self) -> None:
        handler = _handler(importlib.import_module("src.rpc.workspaces"), "rpc.app.workspaces.list")
        workspace = importlib.import_module("tests.test_audit_workspace")._workspace(id=3, slug="owt")
        with patch("src.rpc.workspaces.workspace_service.get_all", AsyncMock(return_value=[workspace])):
            envelope = await handler({"query": {"scope": ["all"]}}, MagicMock())

        self.assertEqual(["owt"], [w["slug"] for w in envelope["data"]])


class ListScopeSignatureTests(IsolatedAsyncioTestCase):
    """The default lives in the service too: a future caller that forgets the
    keyword gets the directory, not everything."""

    async def test_service_default_is_public(self) -> None:
        service = importlib.import_module("src.services.workspace.service")
        rows = [
            SimpleNamespace(id=1, is_hidden=False, verification_status="verified"),
            SimpleNamespace(id=2, is_hidden=False, verification_status="unverified"),
        ]
        with patch.object(service.workspaces.workspace_repo, "list_ordered", AsyncMock(return_value=rows)):
            result = await service.workspaces.get_all(SimpleNamespace())

        self.assertEqual([1], [w.id for w in result])
