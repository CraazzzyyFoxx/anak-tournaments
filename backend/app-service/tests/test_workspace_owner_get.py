"""``rpc.app.workspaces.owner_get`` / ``owner_set`` + ``WorkspaceService.set_owner``
— who is accountable for a workspace, and who may change that.

The gates are the point of this test, and they differ on purpose. The read
resolves ``Workspace.owner_id`` to a username and an email, which
``WorkspaceRead`` deliberately refuses to publish (``GET /api/v1/workspaces/{id}``
is anonymous and the list is cached at the edge), so it sits behind the same
workspace-scoped ``workspace.update`` permission as the ``discord_*`` reads. The
write is stricter still — superuser-only — because ``owner_id`` is what the
per-account create cap is counted over, so an organizer who could reassign it
could hand their own cap away.

Same seams as ``test_workspace_verification_set.py``: the service test runs the
real ``update_fields`` against a namespace workspace with ``record_audit``
patched at the module-level name, while the RPC tests drive the registered
subscriber and only prove the transport wiring.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.factories import make_workspace as _make_workspace  # noqa: E402
from tests.test_audit_workspace import _handler, _workspace  # noqa: E402

workspace_service = importlib.import_module("src.services.workspace.service")
workspaces = workspace_service.workspaces

_GET_SUBJECT = "rpc.app.workspaces.owner_get"
_SET_SUBJECT = "rpc.app.workspaces.owner_set"
_ADMIN = {"user_id": 42, "username": "kate", "is_active": True, "is_superuser": True}
_OUTSIDER = {"user_id": 9, "username": "mallory", "is_active": True, "is_superuser": False}


def _actor() -> SimpleNamespace:
    return SimpleNamespace(id=42, username="kate")


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
        handler = _handler(module, _GET_SUBJECT)
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


class SetOwnerTests(IsolatedAsyncioTestCase):
    async def test_stamps_the_new_owner_and_records_the_before_and_after(self) -> None:
        session = SimpleNamespace(flush=AsyncMock(), commit=AsyncMock())
        workspace = _make_workspace(owner_id=None)

        with patch.object(workspace_service, "record_audit", AsyncMock()) as audit:
            result = await workspaces.set_owner(session, workspace, 11, actor=_actor())

        self.assertIs(result, workspace)
        self.assertEqual(11, workspace.owner_id)
        session.flush.assert_awaited_once()
        session.commit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        self.assertEqual("workspace.owner_set", kwargs["action"])
        self.assertEqual({"owner_id": None}, kwargs["before"])
        self.assertEqual({"owner_id": 11}, kwargs["after"])
        self.assertEqual(7, kwargs["entity_id"])

    async def test_clearing_the_stamp_is_a_reachable_state(self) -> None:
        """A workspace with nobody on the hook is where every pre-self-service
        row already sits, so ``None`` has to be assignable, not only escapable."""
        session = SimpleNamespace(flush=AsyncMock(), commit=AsyncMock())
        workspace = _make_workspace(owner_id=11)

        with patch.object(workspace_service, "record_audit", AsyncMock()) as audit:
            await workspaces.set_owner(session, workspace, None, actor=_actor())

        self.assertIsNone(workspace.owner_id)
        self.assertEqual({"owner_id": 11}, audit.await_args.kwargs["before"])
        self.assertEqual({"owner_id": None}, audit.await_args.kwargs["after"])


class OwnerSetRPCTests(IsolatedAsyncioTestCase):
    async def _call(self, data, *, ws=None, auth_user=None):
        module = importlib.import_module("src.rpc.workspaces")
        handler = _handler(module, _SET_SUBJECT)
        setter = AsyncMock(return_value=ws)
        with (
            patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=ws)),
            patch("src.rpc.workspaces.workspace_service.set_owner", setter),
            patch.object(module._auth_user_repo, "get", AsyncMock(return_value=auth_user)),
        ):
            return await handler(data, MagicMock()), setter

    async def test_a_superuser_assigns_an_owner_and_gets_the_resolved_person_back(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _ADMIN, "payload": {"auth_user_id": 7}},
            ws=_workspace(owner_id=7),
            auth_user=_auth_user(),
        )

        self.assertEqual("ada", envelope["data"]["username"])
        setter.assert_awaited_once()
        self.assertEqual(7, setter.await_args.args[2])

    async def test_a_workspace_admin_may_not_reassign_accountability(self) -> None:
        """``owner_id`` is what the per-account create cap is counted over, so
        this write is superuser-only even though the matching read is not."""
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _OUTSIDER, "payload": {"auth_user_id": 7}},
            ws=_workspace(owner_id=None),
            auth_user=_auth_user(),
        )

        self.assertEqual("forbidden", envelope["error"]["code"])
        setter.assert_not_awaited()

    async def test_404s_an_unknown_target_account_instead_of_an_integrity_error(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _ADMIN, "payload": {"auth_user_id": 4242}},
            ws=_workspace(owner_id=None),
            auth_user=None,
        )

        self.assertEqual("not_found", envelope["error"]["code"])
        setter.assert_not_awaited()

    async def test_a_null_target_clears_without_looking_up_an_account(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _ADMIN, "payload": {"auth_user_id": None}},
            ws=_workspace(owner_id=None),
        )

        self.assertIsNone(envelope["data"])
        self.assertIsNone(setter.await_args.args[2])

    async def test_404s_a_missing_workspace(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _ADMIN, "payload": {"auth_user_id": 7}}, ws=None
        )

        self.assertEqual("not_found", envelope["error"]["code"])
        setter.assert_not_awaited()


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

        for subject in (_GET_SUBJECT, _SET_SUBJECT):
            with self.subTest(subject=subject):
                self.assertIn(subject, registered)
                self.assertTrue(openapi_docs.DOCS[subject]["summary"])
                self.assertIn(subject, openapi_schemas.OPERATIONS)
