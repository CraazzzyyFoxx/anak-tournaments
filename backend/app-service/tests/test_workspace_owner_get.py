"""``rpc.app.workspaces.owner_get`` — who is accountable for a workspace.

The gate is the point of this test. ``Workspace.owner_id`` resolves to a
username and an email, which ``WorkspaceRead`` deliberately refuses to publish
(``GET /api/v1/workspaces/{id}`` is anonymous and the list is cached at the
edge), so this subject must stay behind the same workspace-scoped
``workspace.update`` permission as the ``discord_*`` reads. A read that
answered an outsider would leak exactly what keeping owner off the public model
was meant to prevent.

Same seams as ``test_workspace_verification_set.py``: the registered subscriber
is driven directly and only the transport contract is pinned.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.test_audit_workspace import _handler, _workspace  # noqa: E402

_SUBJECT = "rpc.app.workspaces.owner_get"
_ADMIN = {"user_id": 42, "username": "kate", "is_active": True, "is_superuser": True}
_OUTSIDER = {"user_id": 9, "username": "mallory", "is_active": True, "is_superuser": False}


def _auth_user(**over) -> SimpleNamespace:
    return SimpleNamespace(
        id=over.get("id", 7),
        username=over.get("username", "ada"),
        email=over.get("email", "ada@example.com"),
        first_name=over.get("first_name", "Ada"),
        last_name=over.get("last_name", "Lovelace"),
        avatar_url=over.get("avatar_url", "https://cdn.example.com/ada.webp"),
    )


class OwnerGetRPCTests(IsolatedAsyncioTestCase):
    async def _call(self, data, *, ws=None, auth_user=None, gate=None):
        module = importlib.import_module("src.rpc.workspaces")
        handler = _handler(module, _SUBJECT)
        lookup = AsyncMock(return_value=auth_user)
        with (
            patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=ws)),
            patch.object(module._auth_user_repo, "get", lookup),
            patch("src.rpc.workspaces.ensure_workspace_permission", gate or MagicMock()),
        ):
            return await handler(data, MagicMock()), lookup

    async def test_returns_the_owner_resolved_to_a_person(self) -> None:
        envelope, lookup = await self._call(
            {"workspace_id": 7, "identity": _ADMIN},
            ws=_workspace(owner_id=7),
            auth_user=_auth_user(),
        )

        self.assertEqual(
            {
                "auth_user_id": 7,
                "username": "ada",
                "email": "ada@example.com",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "avatar_url": "https://cdn.example.com/ada.webp",
            },
            envelope["data"],
        )
        lookup.assert_awaited_once()
        self.assertEqual(7, lookup.await_args.args[1])

    async def test_an_unstamped_workspace_answers_null_without_a_user_read(self) -> None:
        """Pre-self-service workspaces and ``SET NULL``-ed owners are a fact to
        render, not an error: the admin screens show "no owner"."""
        envelope, lookup = await self._call(
            {"workspace_id": 7, "identity": _ADMIN},
            ws=_workspace(owner_id=None),
        )

        self.assertIsNone(envelope["data"])
        lookup.assert_not_awaited()

    async def test_a_vanished_owner_row_still_answers_with_the_id(self) -> None:
        envelope, _ = await self._call(
            {"workspace_id": 7, "identity": _ADMIN},
            ws=_workspace(owner_id=7),
            auth_user=None,
        )

        self.assertEqual(7, envelope["data"]["auth_user_id"])
        self.assertIsNone(envelope["data"]["username"])

    async def test_refuses_a_caller_without_workspace_update(self) -> None:
        """The whole reason owner is not on ``WorkspaceRead``."""
        from shared.core.errors import BaseAPIException

        def deny(*args, **kwargs):
            raise BaseAPIException(status_code=403, detail="Permission denied")

        envelope, lookup = await self._call(
            {"workspace_id": 7, "identity": _OUTSIDER},
            ws=_workspace(owner_id=7),
            auth_user=_auth_user(),
            gate=MagicMock(side_effect=deny),
        )

        self.assertEqual("forbidden", envelope["error"]["code"])
        lookup.assert_not_awaited()

    async def test_404s_a_missing_workspace(self) -> None:
        envelope, lookup = await self._call({"workspace_id": 7, "identity": _ADMIN}, ws=None)

        self.assertEqual("not_found", envelope["error"]["code"])
        lookup.assert_not_awaited()


class ManifestTests(IsolatedAsyncioTestCase):
    """Registered, documented and typed: an unregistered subject only shows up
    as a gateway timeout, and one missing from ``OPERATIONS`` degrades to a
    generic ``object`` in the published manifest."""

    def test_registered_documented_and_typed(self) -> None:
        from src import openapi_docs, openapi_schemas

        registered: dict[str, object] = {}

        def subscriber(name, *args, **kwargs):
            def decorator(fn):
                registered[name] = fn
                return fn

            return decorator

        broker = MagicMock()
        broker.subscriber = subscriber
        importlib.import_module("src.rpc.workspaces").register(broker, MagicMock())

        self.assertIn(_SUBJECT, registered)
        self.assertTrue(openapi_docs.DOCS[_SUBJECT]["summary"])
        self.assertIn(_SUBJECT, openapi_schemas.OPERATIONS)
