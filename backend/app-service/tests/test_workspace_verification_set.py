"""``WorkspaceService.set_verification_status`` + the
``rpc.app.workspaces.verification_set`` RPC handler (workspace self-service
design ``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md``
§4.3).

Same seams as ``test_workspace_discord_guild_verify.py``: the service test runs
the real ``update_fields`` (setattr + ``session.flush()``) against a namespace
workspace and patches ``record_audit`` at the module-level name, while the RPC
tests drive the registered subscriber and only prove the transport wiring
(superuser gate, 404, body validation, delegation).

This RPC is the single switch that unblocks GPU compute, inline achievement
recompute and the public directory for a self-service workspace, so the two
things pinned hardest are that a workspace's own owner cannot reach it and that
every call -- including a no-op re-affirmation -- leaves an audit row.
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

_SUPERUSER = {"user_id": 42, "username": "kate", "is_active": True, "is_superuser": True}
_OWNER = {"user_id": 7, "username": "ada", "is_active": True, "is_superuser": False}


def _actor() -> SimpleNamespace:
    return SimpleNamespace(id=42, username="kate")


class SetVerificationStatusTests(IsolatedAsyncioTestCase):
    async def test_moves_the_tier_and_records_the_before_and_after(self) -> None:
        session = SimpleNamespace(flush=AsyncMock(), commit=AsyncMock())
        workspace = _make_workspace(verification_status="unverified")

        with patch.object(workspace_service, "record_audit", AsyncMock()) as audit:
            result = await workspaces.set_verification_status(session, workspace, "verified", actor=_actor())

        self.assertIs(result, workspace)
        self.assertEqual("verified", workspace.verification_status)
        session.flush.assert_awaited_once()
        session.commit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        self.assertEqual("workspace.verification_status_set", kwargs["action"])
        self.assertEqual({"verification_status": "unverified"}, kwargs["before"])
        self.assertEqual({"verification_status": "verified"}, kwargs["after"])
        self.assertEqual(7, kwargs["entity_id"])

    async def test_a_no_op_set_is_still_audited(self) -> None:
        """An idempotent write still leaves a trail: "a superuser looked at this
        and re-affirmed it" is exactly what this journal is for."""
        session = SimpleNamespace(flush=AsyncMock(), commit=AsyncMock())
        workspace = _make_workspace(verification_status="trusted")

        with patch.object(workspace_service, "record_audit", AsyncMock()) as audit:
            await workspaces.set_verification_status(session, workspace, "trusted", actor=_actor())

        self.assertEqual("trusted", workspace.verification_status)
        audit.assert_awaited_once()
        self.assertEqual({"verification_status": "trusted"}, audit.await_args.kwargs["before"])
        self.assertEqual({"verification_status": "trusted"}, audit.await_args.kwargs["after"])


class VerificationSetRPCTests(IsolatedAsyncioTestCase):
    async def _call(self, data, *, ws=None):
        handler = _handler(importlib.import_module("src.rpc.workspaces"), "rpc.app.workspaces.verification_set")
        setter = AsyncMock(return_value=ws)
        with (
            patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=ws)),
            patch("src.rpc.workspaces.workspace_service.set_verification_status", setter),
        ):
            return await handler(data, MagicMock()), setter

    async def test_superuser_sets_the_tier(self) -> None:
        workspace = _workspace(verification_status="trusted")
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _SUPERUSER, "payload": {"verification_status": "trusted"}},
            ws=workspace,
        )

        self.assertEqual("trusted", envelope["data"]["verification_status"])
        setter.assert_awaited_once()
        self.assertEqual("trusted", setter.await_args.args[2])

    async def test_a_workspace_owner_may_not_self_certify(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _OWNER, "payload": {"verification_status": "trusted"}},
            ws=_workspace(),
        )

        self.assertEqual("forbidden", envelope["error"]["code"])
        setter.assert_not_awaited()

    async def test_404s_a_missing_workspace(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _SUPERUSER, "payload": {"verification_status": "verified"}},
            ws=None,
        )

        self.assertEqual("not_found", envelope["error"]["code"])
        setter.assert_not_awaited()

    async def test_rejects_an_unknown_tier_before_any_write(self) -> None:
        envelope, setter = await self._call(
            {"workspace_id": 7, "identity": _SUPERUSER, "payload": {"verification_status": "legit_i_swear"}},
            ws=_workspace(),
        )

        self.assertEqual("unprocessable", envelope["error"]["code"])
        setter.assert_not_awaited()


class ManifestTests(IsolatedAsyncioTestCase):
    """Both new subjects must be registered, documented and typed: an
    unregistered subject only shows up as a gateway timeout, and one missing
    from ``OPERATIONS`` degrades to a generic ``object`` in the published
    manifest (precedent: ``test_catalog_alias_rpc.py``)."""

    _SUBJECTS = ("rpc.app.workspaces.verification_set", "rpc.app.workspaces.my_discord_guilds")

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

        for subject in self._SUBJECTS:
            with self.subTest(subject=subject):
                self.assertIn(subject, registered)
                self.assertTrue(openapi_docs.DOCS[subject]["summary"])
                self.assertIn(subject, openapi_schemas.OPERATIONS)
