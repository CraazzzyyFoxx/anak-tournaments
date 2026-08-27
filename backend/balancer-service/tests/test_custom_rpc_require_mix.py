from __future__ import annotations

import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from src.rpc.custom import _require_mix  # noqa: E402


def _user(is_member: bool = True) -> MagicMock:
    user = MagicMock()
    user.is_workspace_member.return_value = is_member
    return user


class RequireMixTests(TestCase):
    """``_require_mix`` no longer gates ``update``/``delete`` on the coarse
    workspace-level ``custom_game`` permission: a co-host who only holds the
    plain ``member`` role used to 403 here, before ``CustomGameService._writable``
    -- the actual per-game host-or-co-host grant -- ever got a look. Only
    ``create`` still checks the role permission, since a brand-new mix has no
    per-game grant yet to fall back on.
    """

    def test_read_needs_only_membership(self) -> None:
        with patch("src.rpc.custom.c.require_workspace_permission") as perm:
            _require_mix({}, _user(True), 1, "read")
        perm.assert_not_called()

    def test_read_rejects_a_non_member(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _require_mix({}, _user(False), 1, "read")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_create_still_checks_the_workspace_role(self) -> None:
        data = {"workspace_id": 1}
        user = _user(True)
        with patch("src.rpc.custom.c.require_workspace_permission") as perm:
            _require_mix(data, user, 1, "create")
        perm.assert_called_once_with(data, user, 1, "custom_game", "create")

    def test_create_rejects_a_non_member_before_checking_the_role(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _require_mix({}, _user(False), 1, "create")
        self.assertEqual(ctx.exception.status_code, 403)

    def test_update_skips_the_workspace_role_check(self) -> None:
        with patch("src.rpc.custom.c.require_workspace_permission") as perm:
            _require_mix({}, _user(True), 1, "update")
        perm.assert_not_called()

    def test_delete_skips_the_workspace_role_check(self) -> None:
        with patch("src.rpc.custom.c.require_workspace_permission") as perm:
            _require_mix({}, _user(True), 1, "delete")
        perm.assert_not_called()

    def test_update_still_rejects_a_non_member(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            _require_mix({}, _user(False), 1, "update")
        self.assertEqual(ctx.exception.status_code, 403)
