"""Membership for a co-host/host grant target is RBAC, not the player roster.

A workspace member is somebody holding a role scoped to that workspace (plus
the superuser bypass) -- exactly what ``AuthUser.is_workspace_member`` answers
for the caller, and exactly what every mix endpoint gates on. An admin can hold
that role without ever appearing on the workspace's ``workspace_member`` roster,
so requiring a roster row rejected live co-hosts: a production mix carried a
grant for such an account, and the migration guard built on the roster refused
the whole maintenance window rather than lose it.
"""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

from shared.services import workspace_roster


class WorkspaceMemberUserIdsTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    def _session(self, ids: list[int]) -> MagicMock:
        session = MagicMock()
        session.scalars = AsyncMock(return_value=SimpleNamespace(all=lambda: ids))
        return session

    async def test_returns_the_subset_that_belongs(self) -> None:
        session = self._session([9])

        result = await workspace_roster.workspace_member_user_ids(
            session,
            workspace_id=1,
            user_ids=[9, 10],
        )

        self.assertEqual(result, {9})

    async def test_membership_is_a_workspace_role_not_a_roster_row(self) -> None:
        session = self._session([9])

        await workspace_roster.workspace_member_user_ids(session, workspace_id=1, user_ids=[9])

        sql = str(session.scalars.await_args.args[0])
        self.assertIn("user_roles", sql)
        self.assertIn("roles.workspace_id", sql)
        # The roster is a different set in both directions; joining it here is
        # what stranded the RBAC-only co-host.
        self.assertNotIn("workspace_member", sql)

    async def test_a_superuser_belongs_everywhere(self) -> None:
        session = self._session([9])

        await workspace_roster.workspace_member_user_ids(session, workspace_id=1, user_ids=[9])

        self.assertIn("is_superuser", str(session.scalars.await_args.args[0]))

    async def test_no_ids_asks_nothing(self) -> None:
        session = self._session([])

        result = await workspace_roster.workspace_member_user_ids(session, workspace_id=1, user_ids=[])

        self.assertEqual(result, set())
        session.scalars.assert_not_awaited()
