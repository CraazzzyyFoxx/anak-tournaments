"""Workspace sub-roles live in ``catalog.role`` (D31, D86). DB tests need the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException
from shared.rpc.player_sub_role import player_sub_role_entity
from shared.services.player_sub_role import PlayerSubRoleService
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


def _create(workspace_id: int, role: str, label: str, slug: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        workspace_id=workspace_id,
        discipline="overwatch",
        role=role,
        label=label,
        slug=slug,
        description=None,
        sort_order=0,
        is_active=True,
    )


class PlayerSubRoleServiceTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.service = PlayerSubRoleService()
        async with self.Session() as s:
            workspace = models.Workspace(slug=f"psr-{os.getpid()}-{next(_TAG)}", name="psr")
            s.add(workspace)
            await s.commit()
            self.workspace_id = workspace.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    async def test_create_normalizes_the_code_and_hangs_it_under_the_module_role(self) -> None:
        async with self.Session() as s:
            row = await self.service.create_sub_role(s, _create(self.workspace_id, "Support", " Main Heal "))
        assert (row.code, row.name, row.parent.code, row.workspace_id, row.active) == (
            "main_heal",
            "Main Heal",
            "support",
            self.workspace_id,
            True,
        )

    async def test_the_catalog_groups_active_selectable_sub_roles_under_every_top_level_role(self) -> None:
        async with self.Session() as s:
            await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Hitscan"))
            hidden = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Projectile"))
            await self.service.deactivate_sub_role(s, hidden.id)
            catalog = await self.service.catalog_for_workspace(s, self.workspace_id, discipline="overwatch")
        assert catalog == {"tank": [], "damage": [{"slug": "hitscan", "label": "Hitscan"}], "support": []}

    async def test_a_code_reserved_by_a_module_role_or_flex_is_refused(self) -> None:
        for label in ("Tank", "Flex"):
            async with self.Session() as s:
                with self.assertRaises(BaseAPIException) as raised:
                    await self.service.create_sub_role(s, _create(self.workspace_id, "support", label))
            assert raised.exception.status_code == 409
            assert "sub_role_code_reserved" in str(raised.exception.detail)

    async def test_a_code_is_unique_in_the_workspace_even_under_another_role(self) -> None:
        async with self.Session() as s:
            await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Main"))
            with self.assertRaises(BaseAPIException) as raised:
                await self.service.create_sub_role(s, _create(self.workspace_id, "tank", "Main"))
        assert raised.exception.status_code == 409

    async def test_moving_a_sub_role_to_another_role_is_refused(self) -> None:
        async with self.Session() as s:
            row = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Hitscan"))
            with self.assertRaises(BaseAPIException) as raised:
                await self.service.update_sub_role(
                    s, row.id, SimpleNamespace(model_dump=lambda exclude_unset: {"role": "support"})
                )
        assert raised.exception.status_code == 409
        assert "sub_role_parent_fixed" in str(raised.exception.detail)

    async def test_an_unknown_role_is_400_before_any_write(self) -> None:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as raised:
                await self.service.create_sub_role(s, _create(self.workspace_id, "healer", "Main Heal"))
            assert raised.exception.status_code == 400
            assert (
                await s.scalar(sa.select(sa.func.count()).where(models.CatalogRole.workspace_id == self.workspace_id))
                == 0
            )


class EntityConfigTests(IsolatedAsyncioTestCase):
    async def test_list_fn_reads_query_and_serializes_rows(self) -> None:
        cfg = player_sub_role_entity()
        row = SimpleNamespace(
            id=1,
            workspace_id=7,
            code="main_tank",
            name="Main Tank",
            description=None,
            sort_order=0,
            active=True,
            parent=SimpleNamespace(code="tank"),
            dimension=SimpleNamespace(discipline="overwatch", code="player_role"),
        )
        session = object()
        with patch(
            "shared.rpc.player_sub_role.player_sub_role_service.list_sub_roles", AsyncMock(return_value=[row])
        ) as listed:
            result = await cfg.list_fn(session, {"query": {"workspace_id": ["7"], "include_inactive": ["true"]}})
        listed.assert_awaited_once_with(
            session, workspace_id=7, discipline="overwatch", role=None, include_inactive=True
        )
        assert result == [
            {
                "id": 1,
                "workspace_id": 7,
                "discipline": "overwatch",
                "dimension": "player_role",
                "role": "tank",
                "slug": "main_tank",
                "label": "Main Tank",
                "description": None,
                "sort_order": 0,
                "is_active": True,
            }
        ]
