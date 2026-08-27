"""Tests for workspace-aware balancer auth dependencies."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"

for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

os.environ["DEBUG"] = "false"

from src.core import auth  # noqa: E402


class WorkspaceAuthDependencyTests(IsolatedAsyncioTestCase):
    async def test_token_resolver_populates_workspace_rbac_cache(self) -> None:
        user = await auth._resolve_user_from_token(  # type: ignore[attr-defined]
            42,
            {
                "username": "member",
                "email": "member@example.com",
                "roles": [],
                "permissions": [],
                "workspaces": [
                    {
                        "workspace_id": 7,
                        "slug": "ws-7",
                        "rbac_roles": ["editor"],
                        "rbac_permissions": [{"resource": "team", "action": "create"}],
                    }
                ],
            },
        )

        self.assertTrue(user.is_workspace_member(7))
        self.assertFalse(user.is_workspace_admin(7))
        self.assertTrue(user.has_workspace_permission(7, "team", "create"))
        self.assertFalse(user.has_workspace_permission(8, "team", "create"))

