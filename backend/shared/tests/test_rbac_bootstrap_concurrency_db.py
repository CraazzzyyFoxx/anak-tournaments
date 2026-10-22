"""RBAC seeding under concurrency: two transactions bootstrapping the same rows.

Concurrent ``POST /workspaces`` on a fresh database both found the permission
catalog empty and both inserted it; the loser died on ``ix_auth_permissions_name``
(a 500). The race is replayed deterministically: the first transaction writes and
stays open, the second runs the same bootstrap until Postgres parks it on the
first's row, then the first commits. Needs the test Postgres; skips otherwise.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from collections.abc import Awaitable, Callable
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.models.identity.rbac import Permission
from shared.models.tenancy.workspace import Workspace
from shared.rbac import bootstrap
from shared.rbac.catalog import (
    PERMISSION_CATALOG,
    WORKSPACE_SYSTEM_ROLE_NAMES,
    PermissionSpec,
    permission_names_for_workspace_role,
)
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class RbacBootstrapRaceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"rbacrace-{os.getpid()}-{next(_TAG)}"

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(Workspace).where(Workspace.slug == self.tag))
            await s.execute(sa.delete(Permission).where(Permission.name == self.tag))
            await s.commit()
        await self.engine.dispose()

    async def _race(self, seed: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
        """``seed`` in two transactions; the second must outlast the first's commit."""
        async with self.Session() as first, self.Session() as second:
            await seed(first)
            pid = await second.scalar(sa.text("SELECT pg_backend_pid()"))
            racer = asyncio.create_task(seed(second))
            async with self.engine.connect() as probe:
                for _ in range(200):
                    if racer.done():
                        break
                    waiting = await probe.scalar(
                        sa.text("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"),
                        {"pid": pid},
                    )
                    if waiting:
                        break
                    await asyncio.sleep(0.05)
                else:
                    self.fail("the second bootstrap never waited on the first")
            await first.commit()
            result = await racer
            await second.commit()
            return result

    async def _scalar(self, sql: str, **params: object) -> int:
        async with self.Session() as s:
            return int(await s.scalar(sa.text(sql), params) or 0)

    async def test_a_permission_both_transactions_insert_is_created_once(self) -> None:
        catalog = (*PERMISSION_CATALOG, PermissionSpec(self.tag, "racetest", self.tag, "race"))
        with patch.object(bootstrap, "PERMISSION_CATALOG", catalog):
            permissions = await self._race(bootstrap.ensure_permission_catalog)

        self.assertIn(self.tag, permissions)
        self.assertEqual(1, await self._scalar("SELECT count(*) FROM auth.permissions WHERE name = :n", n=self.tag))

    async def test_system_roles_both_transactions_seed_are_created_once(self) -> None:
        async with self.Session() as s:
            workspace = Workspace(slug=self.tag, name=self.tag)
            s.add(workspace)
            await s.commit()

        roles = await self._race(lambda session: bootstrap.ensure_workspace_system_roles(session, workspace.id))

        self.assertEqual(set(WORKSPACE_SYSTEM_ROLE_NAMES), set(roles))
        self.assertEqual(
            len(WORKSPACE_SYSTEM_ROLE_NAMES),
            await self._scalar("SELECT count(*) FROM auth.roles WHERE workspace_id = :ws", ws=workspace.id),
        )
        self.assertEqual(
            sum(len(permission_names_for_workspace_role(name)) for name in WORKSPACE_SYSTEM_ROLE_NAMES),
            await self._scalar(
                "SELECT count(*) FROM auth.role_permissions rp JOIN auth.roles r ON r.id = rp.role_id"
                " WHERE r.workspace_id = :ws",
                ws=workspace.id,
            ),
        )
