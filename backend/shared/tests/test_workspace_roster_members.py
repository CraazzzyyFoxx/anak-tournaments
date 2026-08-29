from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

from shared.services import workspace_roster


class WorkspaceMembersByUserIdTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def test_returns_only_real_workspace_members(self) -> None:
        session = MagicMock()
        session.execute = AsyncMock(return_value=SimpleNamespace(all=lambda: [(9, 71)]))

        result = await workspace_roster.workspace_members_by_user_id(
            session,
            workspace_id=1,
            user_ids=[9, 10],
        )

        self.assertEqual(result, {9: 71})
        sql = str(session.execute.await_args.args[0])
        self.assertIn("JOIN workspace_member", sql)
        self.assertNotIn("LEFT OUTER JOIN workspace_member", sql)
