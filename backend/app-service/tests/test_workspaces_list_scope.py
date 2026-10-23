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

    async def test_serializes_what_the_service_returns_without_grids(self) -> None:
        handler = _handler(importlib.import_module("src.rpc.workspaces"), "rpc.app.workspaces.list")
        workspace = importlib.import_module("tests.test_audit_workspace")._workspace(id=3, slug="owt")
        with patch("src.rpc.workspaces.workspace_service.get_all", AsyncMock(return_value=[workspace])):
            envelope = await handler({"query": {"scope": ["all"]}}, MagicMock())

        self.assertEqual(["owt"], [w["slug"] for w in envelope["data"]])
        self.assertNotIn("effective_division_grid_versions", envelope["data"][0])


class BySlugRPCTests(IsolatedAsyncioTestCase):
    """``rpc.app.workspaces.by_slug`` transport; its visibility is ``WorkspaceGetAllVisibilityTests``'."""

    async def _call(self, data, found):
        handler = _handler(importlib.import_module("src.rpc.workspaces"), "rpc.app.workspaces.by_slug")
        lookup = AsyncMock(return_value=found)
        with patch("src.rpc.workspaces.workspace_service.get_visible_by_slug", lookup):
            return await handler(data, MagicMock()), lookup

    async def test_asks_with_the_slug_and_the_viewer(self) -> None:
        _envelope, lookup = await self._call({"query": {"slug": ["owt"]}, "identity": _SUPERUSER}, None)

        self.assertEqual("owt", lookup.await_args.args[1])
        self.assertTrue(lookup.await_args.kwargs["user"].is_superuser)

    async def test_a_workspace_the_viewer_may_not_see_is_a_404(self) -> None:
        envelope, _lookup = await self._call({"query": {"slug": ["hidden"]}}, None)

        self.assertEqual("not_found", envelope["error"]["code"])

    async def test_answers_the_full_read(self) -> None:
        workspace = importlib.import_module("tests.test_audit_workspace")._workspace(id=3, slug="owt")
        envelope, _lookup = await self._call({"query": {"slug": ["owt"]}}, workspace)

        self.assertEqual("owt", envelope["data"]["slug"])
        self.assertIn("effective_division_grid_versions", envelope["data"])
