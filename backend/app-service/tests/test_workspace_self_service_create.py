"""Self-service workspace creation: ``provision``'s ``owner_id`` stamp, the
reserved-slug denylist and the reopened ``rpc.app.workspaces.create`` gate
(workspace self-service design
``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md`` §4.4).

``create`` used to be superuser-only; it is now open to any ACTIVE
authenticated user, which makes three things load-bearing and each is pinned
here: the per-account cap runs before the write, the platform's own slugs stay
unclaimable, and a new workspace is stamped with an accountable owner while
staying ``unverified``.

The RPC cases reuse ``test_audit_workspace``'s capture harness (``_handler`` +
``_RecordingSession``), like ``test_audit_workspace_members.py`` does; the
audit row itself is that module's subject, not this one's.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.test_audit_workspace import _RecordingSession, _handler, _workspace  # noqa: E402

workspace_service = importlib.import_module("src.services.workspace.service")
workspaces_rpc = importlib.import_module("src.rpc.workspaces")
workspaces = workspace_service.workspaces

_ACTIVE = {"user_id": 1, "username": "ada", "is_active": True, "is_superuser": False}
_INACTIVE = {"user_id": 1, "username": "ada", "is_active": False, "is_superuser": False}
_SUPERUSER = {"user_id": 42, "username": "kate", "is_active": True, "is_superuser": True}
_REVOKED = {"resource": "workspace", "action": "self_create", "workspace_id": None}


class ReservedSlugTests(IsolatedAsyncioTestCase):
    def test_rejects_a_platform_slug(self) -> None:
        for slug in ("admin", "api", "www", "app", "static", "docs", "status", "support"):
            with self.subTest(slug=slug), self.assertRaises(workspace_service.HTTPException) as ctx:
                workspace_service.reject_reserved_slug(slug)
            self.assertEqual(400, ctx.exception.status_code)
            self.assertEqual("slug_reserved", ctx.exception.detail)

    def test_rejects_regardless_of_casing_or_padding(self) -> None:
        """``WorkspaceCreate`` already lowercases nothing -- its pattern only
        permits lowercase -- but the denylist must not be the thing that a
        future looser pattern slips past."""
        with self.assertRaises(workspace_service.HTTPException):
            workspace_service.reject_reserved_slug(" ADMIN ")

    def test_allows_an_ordinary_slug(self) -> None:
        workspace_service.reject_reserved_slug("acme-cup")


class ProvisionOwnerTests(IsolatedAsyncioTestCase):
    async def test_stamps_owner_id_and_still_grants_the_rbac_owner_role(self) -> None:
        """Two distinct writes for two distinct concerns, in one transaction:
        ``owner_id`` is accountability (the create cap), the RBAC role is
        permission. Neither replaces the other."""
        session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
        created: list[object] = []

        async def _capture(_session, obj):
            created.append(obj)
            return obj

        with (
            patch.object(workspaces, "get_by_slug", AsyncMock(return_value=None)),
            patch.object(workspaces.workspace_repo, "create", AsyncMock(side_effect=_capture)),
            patch.object(workspace_service, "get_default_division_grid_version_id", AsyncMock(return_value=3)),
            patch.object(workspace_service, "ensure_workspace_system_roles", AsyncMock()),
            patch.object(workspaces, "add_member", AsyncMock()),
            patch.object(workspace_service, "assign_workspace_system_role", AsyncMock()) as grant,
        ):
            workspace = await workspaces.provision(
                session, payload={"slug": "acme", "name": "Acme Cup"}, owner_auth_user_id=42
            )

        self.assertIs(created[0], workspace)
        self.assertEqual(42, workspace.owner_id)
        # Never stamped in Python: the column's server_default ("unverified") is
        # what a new workspace gets, so no actor -- superuser included -- can be
        # born verified.
        self.assertIsNone(workspace.verification_status)
        grant.assert_awaited_once()
        self.assertEqual(
            {"user_id": 42, "workspace_id": workspace.id, "role_name": "owner"},
            grant.await_args.kwargs,
        )
        session.commit.assert_awaited_once()


class CreateRPCTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        p = patch.object(workspaces_rpc, "_invalidate_auth_rbac_cache", AsyncMock())
        p.start()
        self.addCleanup(p.stop)

    async def _call(self, identity, payload, *, limit_error=None):
        session = _RecordingSession()
        handler = _handler(workspaces_rpc, "rpc.app.workspaces.create")

        async def _provision(_session, **kwargs):
            await _session.commit()
            return _workspace()

        provision = AsyncMock(side_effect=_provision)
        limit = AsyncMock(side_effect=limit_error)
        with (
            patch.object(workspaces_rpc, "_SF", lambda: session),
            patch.object(workspaces_rpc.workspace_service, "ensure_create_limit", limit),
            patch.object(workspaces_rpc.workspace_service, "provision", provision),
        ):
            envelope = await handler({"identity": identity, "payload": payload}, MagicMock())
        return envelope, provision, limit

    async def test_an_active_non_superuser_may_create_a_workspace(self) -> None:
        envelope, provision, limit = await self._call(_ACTIVE, {"slug": "acme", "name": "Acme Cup"})

        self.assertEqual("acme", envelope["data"]["slug"])
        self.assertEqual("unverified", envelope["data"]["verification_status"])
        limit.assert_awaited_once()
        self.assertEqual(1, provision.await_args.kwargs["owner_auth_user_id"])

    async def test_a_superuser_may_still_create_a_workspace(self) -> None:
        envelope, provision, _ = await self._call(_SUPERUSER, {"slug": "acme", "name": "Acme Cup"})

        self.assertIn("data", envelope)
        self.assertEqual(42, provision.await_args.kwargs["owner_auth_user_id"])

    async def test_an_inactive_user_is_still_rejected(self) -> None:
        envelope, provision, _ = await self._call(_INACTIVE, {"slug": "acme", "name": "Acme Cup"})

        self.assertEqual("forbidden", envelope["error"]["code"])
        provision.assert_not_awaited()

    async def test_a_reserved_slug_is_rejected_before_the_write(self) -> None:
        envelope, provision, _ = await self._call(_ACTIVE, {"slug": "admin", "name": "Admin"})

        self.assertEqual("bad_request", envelope["error"]["code"])
        self.assertEqual("slug_reserved", envelope["error"]["message"])
        provision.assert_not_awaited()

    async def test_the_create_cap_propagates_and_blocks_the_write(self) -> None:
        from shared.core.errors import BaseAPIException

        envelope, provision, _ = await self._call(
            _ACTIVE,
            {"slug": "acme", "name": "Acme Cup"},
            limit_error=BaseAPIException(status_code=403, detail="workspace_create_limit_reached"),
        )

        self.assertEqual("forbidden", envelope["error"]["code"])
        self.assertEqual("workspace_create_limit_reached", envelope["error"]["message"])
        provision.assert_not_awaited()

    # --- the revocable capability (negative RBAC) ---------------------------

    async def test_a_denied_account_may_not_create_and_is_never_counted(self) -> None:
        """``workspace.self_create`` is allow-by-default, so a deny row is the
        only way to revoke self-service creation from one account. It is checked
        before the cap: a revoked account has no business learning how full it
        is."""
        envelope, provision, limit = await self._call(
            dict(_ACTIVE, denies=[_REVOKED]), {"slug": "acme", "name": "Acme Cup"}
        )

        self.assertEqual("forbidden", envelope["error"]["code"])
        self.assertEqual("You are not allowed to create workspaces", envelope["error"]["message"])
        limit.assert_not_awaited()
        provision.assert_not_awaited()

    async def test_the_deny_beats_the_superuser_bypass(self) -> None:
        """``UserPermissionDeny`` overrides every grant including that bypass —
        and a superuser can always lift their own deny, so this loses nobody
        their platform."""
        envelope, provision, _ = await self._call(
            dict(_SUPERUSER, denies=[_REVOKED]), {"slug": "acme", "name": "Acme Cup"}
        )

        self.assertEqual("forbidden", envelope["error"]["code"])
        provision.assert_not_awaited()

    async def test_a_deny_on_another_capability_leaves_creation_alone(self) -> None:
        """Exact ``(resource, action)`` match only — no wildcard expansion, and
        the workspace-scoped ``workspace.create`` grant is a different
        permission from this platform-wide one."""
        envelope, provision, _ = await self._call(
            dict(_ACTIVE, denies=[{"resource": "workspace", "action": "create", "workspace_id": None}]),
            {"slug": "acme", "name": "Acme Cup"},
        )

        self.assertIn("data", envelope)
        provision.assert_awaited_once()

    async def test_a_workspace_scoped_deny_cannot_revoke_a_platform_wide_right(self) -> None:
        """Creating a workspace happens outside any workspace, so only a global
        deny (``workspace_id=None``) can revoke it."""
        envelope, provision, _ = await self._call(
            dict(_ACTIVE, denies=[{"resource": "workspace", "action": "self_create", "workspace_id": 5}]),
            {"slug": "acme", "name": "Acme Cup"},
        )

        self.assertIn("data", envelope)
        provision.assert_awaited_once()
