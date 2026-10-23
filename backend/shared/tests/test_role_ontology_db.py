"""The ontology projection (D31), the per-workspace ontology and role resolution. Needs the test Postgres."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.disciplines import DISCIPLINES, DimensionSpec, DisciplineSpec, RoleSpec
from shared.domain.roles import UnknownRole
from shared.repository import CatalogRoleRepository
from shared.services.ontology import project_disciplines
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


def _spec(code: str, *roles: str) -> DisciplineSpec:
    return DisciplineSpec(
        code,
        code,
        dimensions=(DimensionSpec("lane", "Lane", "single", True, tuple(RoleSpec(r, r.title()) for r in roles)),),
    )


class RoleOntologyTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop  # psycopg async cannot run on the Proactor loop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        self.tag = f"onto-{os.getpid()}-{next(_TAG)}"
        self.roles = CatalogRoleRepository()

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            dims = sa.select(models.RoleDimension.id).where(models.RoleDimension.discipline == self.tag)
            await s.execute(sa.delete(models.CatalogRole).where(models.CatalogRole.dimension_id.in_(dims)))
            await s.execute(sa.delete(models.RoleDimension).where(models.RoleDimension.discipline == self.tag))
            await s.execute(sa.delete(models.Discipline).where(models.Discipline.code == self.tag))
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.slug.like(f"{self.tag}%")))
            await s.commit()
        await self.engine.dispose()

    async def _workspace(self, suffix: str) -> int:
        async with self.Session() as s:
            workspace = models.Workspace(slug=f"{self.tag}-{suffix}", name=f"{self.tag} {suffix}")
            s.add(workspace)
            await s.commit()
            return workspace.id

    async def _sub_role(self, workspace_id: int, parent: str, code: str) -> None:
        async with self.Session() as s:
            parent_row = await self.roles.resolve(
                s, discipline="overwatch", workspace_id=None, dimension="player_role", code=parent
            )
            s.add(
                models.CatalogRole(
                    dimension_id=parent_row.dimension_id,
                    workspace_id=workspace_id,
                    parent_role_id=parent_row.id,
                    code=code,
                    name=code.title(),
                )
            )
            await s.commit()

    async def test_the_projection_is_idempotent_and_matches_the_seeded_overwatch_rows(self) -> None:
        async with self.Session() as s:
            before = await self.roles.ontology(s, discipline="overwatch", workspace_id=None)
        for _ in range(2):
            async with self.Session() as s:
                await project_disciplines(s)
                await s.commit()
        async with self.Session() as s:
            overwatch = await self.roles.ontology(s, discipline="overwatch", workspace_id=None)
            lol = await self.roles.ontology(s, discipline="lol", workspace_id=None)
        assert {(r.code, r.id) for r in overwatch.roots("player_role")} == {
            (r.code, r.id) for r in before.roots("player_role")
        }
        assert lol.rated.code == "position"
        assert [r.code for r in lol.roots("position")] == [r.code for r in DISCIPLINES["lol"].rated_dimension.roles]

    async def test_a_role_the_module_stops_declaring_is_deactivated_not_deleted(self) -> None:
        for spec in (_spec(self.tag, "top", "mid"), _spec(self.tag, "top")):
            async with self.Session() as s:
                await self.roles.project_module(s, spec)
                await s.commit()
        async with self.Session() as s:
            ontology = await self.roles.ontology(s, discipline=self.tag, workspace_id=None)
        assert [(r.code, r.active) for r in ontology.roots("lane")] == [("top", True), ("mid", False)]

    async def test_a_module_without_exactly_one_rated_dimension_is_refused_before_any_write(self) -> None:
        unrated = DisciplineSpec(self.tag, self.tag, dimensions=(DimensionSpec("lane", "Lane", "single", False, ()),))
        async with self.Session() as s:
            with self.assertRaises(LookupError):
                await self.roles.project_module(s, unrated)
            count = sa.select(sa.func.count()).select_from(models.Discipline).where(models.Discipline.code == self.tag)
            assert await s.scalar(count) == 0

    async def test_the_ontology_holds_module_roles_and_one_workspace_s_sub_roles(self) -> None:
        mine, theirs = await self._workspace("mine"), await self._workspace("theirs")
        await self._sub_role(mine, "damage", "hitscan")
        await self._sub_role(theirs, "damage", "projectile")
        async with self.Session() as s:
            ontology = await self.roles.ontology(s, discipline="overwatch", workspace_id=mine)
        hitscan = ontology.node("player_role", "hitscan")
        assert ontology.root(hitscan).code == "damage"
        with self.assertRaises(UnknownRole):
            ontology.node("player_role", "projectile")

    async def test_resolve_finds_a_workspace_sub_role_and_refuses_another_workspace_s(self) -> None:
        mine, theirs = await self._workspace("mine"), await self._workspace("theirs")
        await self._sub_role(theirs, "support", "main_heal")
        async with self.Session() as s:
            found = await self.roles.resolve(
                s, discipline="overwatch", workspace_id=theirs, dimension=None, code="main_heal"
            )
            assert (found.code, found.parent.code, found.dimension.code) == ("main_heal", "support", "player_role")
            with self.assertRaises(UnknownRole):
                await self.roles.resolve(s, discipline="overwatch", workspace_id=mine, dimension=None, code="main_heal")
