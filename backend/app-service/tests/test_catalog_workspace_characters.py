"""The organizer character read is confined to a workspace that exists and runs the game (real PostgreSQL)."""

from __future__ import annotations

import asyncio
import sys
import uuid
from contextlib import asynccontextmanager
from unittest import IsolatedAsyncioTestCase

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.testing import create_test_async_engine, ensure_test_postgres
from src.rpc import metadata_admin as metadata_admin_rpc
from tests.conftest import RpcHarness

_SUBJECT = "rpc.app.catalog.workspace_characters"


def _organizer(workspace_id: int) -> dict:
    return {
        "user_id": 5,
        "is_active": True,
        "workspaces": [
            {
                "workspace_id": workspace_id,
                "rbac_roles": [],
                "rbac_permissions": [{"resource": "achievement", "action": "update"}],
            }
        ],
    }


class WorkspaceCharactersTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.connection = await self.engine.connect()
        self.transaction = await self.connection.begin()
        self.session = AsyncSession(self.connection, expire_on_commit=False, join_transaction_mode="create_savepoint")
        tag = uuid.uuid4().hex[:10]
        self.workspace = models.Workspace(
            slug=f"{tag}-ow", name=f"{tag}-ow", disciplines_enabled=["overwatch"], verification_status="verified"
        )
        self.session.add(self.workspace)
        self.session.add(
            models.CatalogEntity(discipline="lol", kind="character", slug=f"{tag}-ahri", name=f"{tag}-ahri")
        )
        self.session.add(
            models.CatalogEntity(
                discipline="overwatch",
                kind="character",
                slug=f"{tag}-ana",
                name=f"{tag}-ana",
                attrs={"class": "support"},
            )
        )
        await self.session.flush()
        self.tag = tag

        @asynccontextmanager
        async def _factory():  # the handler's own session is this rolled-back one
            yield self.session

        self._original = metadata_admin_rpc._SF
        metadata_admin_rpc._SF = _factory
        self.rpc = RpcHarness().register(metadata_admin_rpc)

    async def asyncTearDown(self) -> None:
        metadata_admin_rpc._SF = self._original
        await self.session.close()
        await self.transaction.rollback()
        await self.connection.close()
        await self.engine.dispose()

    async def read(self, workspace_id: int, discipline: str) -> dict:
        return await self.rpc.call(
            _SUBJECT,
            {"workspace_id": workspace_id, "discipline": discipline, "identity": _organizer(workspace_id)},
        )

    async def test_an_enabled_discipline_lists_its_characters(self) -> None:
        reply = await self.read(self.workspace.id, "overwatch")
        self.assertTrue(reply["ok"], reply)
        self.assertIn(f"{self.tag}-ana", {row["slug"] for row in reply["data"]["results"]})

    async def test_a_discipline_the_workspace_does_not_run_is_refused_before_the_catalogue_is_read(self) -> None:
        reply = await self.read(
            self.workspace.id, "lol"
        )  # the League catalogue holds a character; the workspace is OW-only
        self.assertFalse(reply["ok"])
        self.assertEqual("unprocessable", reply["error"]["code"])
        self.assertNotIn(f"{self.tag}-ahri", str(reply))

    async def test_an_unknown_discipline_is_refused_too(self) -> None:
        reply = await self.read(self.workspace.id, "chess")
        self.assertEqual("unprocessable", reply["error"]["code"])

    async def test_a_missing_workspace_is_not_found(self) -> None:
        missing = 2_000_000_000
        reply = await self.read(missing, "overwatch")
        self.assertEqual("not_found", reply["error"]["code"])
