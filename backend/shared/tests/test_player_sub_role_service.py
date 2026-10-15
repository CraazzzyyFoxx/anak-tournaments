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
from shared.rpc.crud import CrudDispatcher
from shared.rpc.player_sub_role import player_sub_role_entity
from shared.schemas.player_sub_role import PlayerSubRoleUpdate
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
            "support_main_heal",
            "Main Heal",
            "support",
            self.workspace_id,
            True,
        )

    async def test_create_rejects_codes_over_64_after_normalization(self) -> None:
        for label, slug in (("Short", "x" * 58), ("x" * 58, None)):
            async with self.Session() as s:
                with self.assertRaises(BaseAPIException) as raised:
                    await self.service.create_sub_role(s, _create(self.workspace_id, "damage", label, slug))
                assert raised.exception.status_code == 422
                assert (
                    await s.scalar(
                        sa.select(sa.func.count()).where(models.CatalogRole.workspace_id == self.workspace_id)
                    )
                    == 0
                )

    async def test_update_rejects_codes_over_64_without_changing_the_row(self) -> None:
        async with self.Session() as s:
            row = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Hitscan"))
            for payload in ({"slug": "x" * 58}, {"slug": None, "label": "x" * 58}):
                with self.assertRaises(BaseAPIException) as raised:
                    await self.service.update_sub_role(s, row.id, PlayerSubRoleUpdate(**payload))
                assert raised.exception.status_code == 422
                await s.refresh(row)
                assert (row.code, row.name) == ("damage_hitscan", "Hitscan")

    async def test_code_limit_uses_normalized_length_on_create_and_update(self) -> None:
        async with self.Session() as s:
            row = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Long", f"\t{'X' * 57}\n"))
            assert row.code == "damage_" + "x" * 57
            row = await self.service.update_sub_role(
                s, row.id, PlayerSubRoleUpdate(slug=f"\t{'Y' * 28} \t {'Z' * 28}\n")
            )
            assert row.code == "damage_" + "y" * 28 + "_" + "z" * 28

    async def test_rpc_create_audits_persisted_normalized_catalog_values(self) -> None:
        cfg = player_sub_role_entity()
        dispatcher = CrudDispatcher({cfg.entity: cfg}, self.Session)
        result = await dispatcher.do_create(
            {
                "entity": cfg.entity,
                "identity": {"user_id": 1, "username": "root", "is_superuser": True},
                "payload": {
                    "workspace_id": self.workspace_id,
                    "discipline": "overwatch",
                    "role": "Damage",
                    "slug": "\tHit Scan\n",
                    "label": " Hitscan ",
                    "is_active": False,
                },
            }
        )
        assert result["ok"], result
        async with self.Session() as s:
            row = await s.scalar(
                sa.select(models.CatalogRole).where(models.CatalogRole.workspace_id == self.workspace_id)
            )
            audit = await s.scalar(
                sa.select(models.AuditLog).where(
                    models.AuditLog.workspace_id == self.workspace_id,
                    models.AuditLog.action == "player_sub_role.create",
                )
            )
            assert audit.entity_id == row.id
            assert audit.entity_label == row.name == "Hitscan"
            assert audit.after_json == {
                "id": row.id,
                "workspace_id": self.workspace_id,
                "discipline": "overwatch",
                "dimension": "player_role",
                "role": "damage",
                "slug": "hit_scan",
                "label": "Hitscan",
                "description": None,
                "sort_order": 0,
                "is_active": False,
            }

    async def test_the_catalog_groups_active_selectable_sub_roles_under_every_top_level_role(self) -> None:
        async with self.Session() as s:
            await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Hitscan"))
            hidden = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Projectile"))
            await self.service.deactivate_sub_role(s, hidden.id)
            catalog = await self.service.catalog_for_workspace(s, self.workspace_id, discipline="overwatch")
        assert catalog == {"tank": [], "damage": [{"slug": "hitscan", "label": "Hitscan"}], "support": []}

    async def test_a_slug_may_equal_a_module_role_or_flex(self) -> None:
        for label in ("Tank", "Flex"):
            async with self.Session() as s:
                row = await self.service.create_sub_role(s, _create(self.workspace_id, "support", label))
            assert row.code == f"support_{label.lower()}"

    async def test_a_slug_is_unique_under_its_parent_but_reusable_under_another(self) -> None:
        async with self.Session() as s:
            damage = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Main"))
            support = await self.service.create_sub_role(s, _create(self.workspace_id, "support", "Main"))
            assert (damage.code, support.code) == ("damage_main", "support_main")
            with self.assertRaises(BaseAPIException) as raised:
                await self.service.create_sub_role(s, _create(self.workspace_id, "support", "Main"))
        assert raised.exception.status_code == 409

    async def test_form_pair_resolves_the_scoped_parent_qualified_leaf(self) -> None:
        from shared.services.ontology import rated_leaf

        async with self.Session() as s:
            damage = await self.service.create_sub_role(s, _create(self.workspace_id, "damage", "Main"))
            support = await self.service.create_sub_role(s, _create(self.workspace_id, "support", "Main"))
            for role, expected in (("damage", damage), ("support", support)):
                found = await rated_leaf(
                    s, discipline="overwatch", workspace_id=self.workspace_id, role=role, sub_role="\tMain\n"
                )
                assert found.id == expected.id
            for role, sub_role, discipline, workspace_id, error in (
                ("support", "main", "overwatch", -1, "unknown_sub_role"),
                ("tank", "main", "overwatch", self.workspace_id, "unknown_sub_role"),
                ("support", "missing", "overwatch", self.workspace_id, "unknown_sub_role"),
                ("support", "main", "missing", self.workspace_id, "unknown_role"),
            ):
                with self.assertRaises(BaseAPIException) as raised:
                    await rated_leaf(s, discipline=discipline, workspace_id=workspace_id, role=role, sub_role=sub_role)
                assert raised.exception.status_code == 422
                assert error in str(raised.exception.detail)
            assert (
                await rated_leaf(
                    s, discipline="overwatch", workspace_id=self.workspace_id, role="support", sub_role=None
                )
            ).id == support.parent_role_id
            for role in (None, "flex"):
                assert (
                    await rated_leaf(
                        s, discipline="overwatch", workspace_id=self.workspace_id, role=role, sub_role="main"
                    )
                    is None
                )

    async def test_crud_slug_round_trips_without_duplicating_the_parent(self) -> None:
        cfg = player_sub_role_entity()
        async with self.Session() as s:
            row = await self.service.create_sub_role(s, _create(self.workspace_id, "support", "Main"))
            payload = await cfg.serializer(s, row)
            assert payload["slug"] == "main"
            row = await self.service.update_sub_role(s, row.id, PlayerSubRoleUpdate(slug=payload["slug"]))
            assert row.code == "support_main"

    async def test_code_and_slug_helpers_strip_only_the_parent_prefix(self) -> None:
        from shared.domain.player_sub_roles import workspace_sub_role_code, workspace_sub_role_slug

        for slug in ("main", "support_main", "main_heal"):
            code = workspace_sub_role_code("support", f"\t{slug}\n")
            assert code == f"support_{slug}"
            assert workspace_sub_role_slug("support", code) == slug
        assert workspace_sub_role_code("support", " \t\n") is None

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
            code="tank_main_tank",
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
