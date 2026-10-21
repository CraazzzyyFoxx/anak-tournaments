"""Registration preferences hold catalog leaves, with matching Python and SQL projections."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.domain.roster import PlayerRoster, RosterRole
from shared.repository import CatalogRoleRepository
from shared.services.roster import roster_engine
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class RegistrationRoleTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"rr-{os.getpid()}-{next(_TAG)}"
        roles = CatalogRoleRepository()
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            support = await roles.resolve(s, discipline="overwatch", workspace_id=None, dimension=None, code="support")
            s.add(
                models.CatalogRole(
                    dimension_id=support.dimension_id,
                    workspace_id=workspace.id,
                    parent_role_id=support.id,
                    code="support_main_heal",
                    name="Main Heal",
                )
            )
            tournament = models.Tournament(workspace_id=workspace.id, name=tag, slug=tag)
            s.add(tournament)
            await s.flush()
            self.rows = await roles.rated_rows(s, discipline="overwatch", workspace_id=workspace.id)
            registration = models.Registration(tournament_id=tournament.id)
            registration.roles = [
                models.RegistrationRole(
                    catalog_role=self.rows["support_main_heal"], dimension_id=support.dimension_id, priority=0
                ),
                models.RegistrationRole(catalog_role=self.rows["tank"], dimension_id=support.dimension_id, priority=1),
            ]
            s.add(registration)
            await s.commit()
            self.registration_id = registration.id
            self.tournament_id = tournament.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            if hasattr(self, "tournament_id"):
                await s.execute(sa.delete(models.Tournament).where(models.Tournament.id == self.tournament_id))
            if hasattr(self, "workspace_id"):
                await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    async def test_rated_rows_hold_module_roles_and_owned_sub_roles(self) -> None:
        assert {"tank", "damage", "support", "support_main_heal"} <= set(self.rows)
        assert self.rows["support_main_heal"].parent.code == "support"
        async with self.Session() as s:
            module = await CatalogRoleRepository().rated_rows(s, discipline="overwatch", workspace_id=None)
        assert "support_main_heal" not in module

    async def test_role_and_subrole_read_the_leaf_in_python_and_sql(self) -> None:
        role = models.RegistrationRole
        async with self.Session() as s:
            loaded = (
                await s.scalars(
                    sa.select(role).where(role.registration_id == self.registration_id).order_by(role.priority)
                )
            ).all()
            rows = (
                await s.execute(
                    sa.select(role.role, role.subrole)
                    .where(role.registration_id == self.registration_id)
                    .order_by(role.role)
                )
            ).all()
        assert [(row.role, row.subrole) for row in loaded] == [("support", "support_main_heal"), ("tank", None)]
        assert [(row.role, row.subrole) for row in rows] == [("support", "support_main_heal"), ("tank", None)]


class RosterRoleCodeTests(TestCase):
    def test_forced_roles_follow_the_supplied_module_vocabulary(self) -> None:
        declared = SimpleNamespace(role="striker", priority=0, id=1, is_active=True, is_primary=True)
        registration = SimpleNamespace(roles=[declared])
        rows = roster_engine._declared_roles(registration, mode="forced", role_codes=("keeper", "striker"))
        assert rows == (declared, "keeper")
        assert roster_engine._declared_roles(registration, mode="optional", role_codes=("keeper", "striker")) == (
            declared,
        )
        role = RosterRole(role="striker", rank=1200, source="registration", is_primary=True, priority=0, subrole=None)
        roster = PlayerRoster(1, None, None, None, None, None, (role,), False)
        assert roster.rank_on("striker") == 1200
        assert roster.source_on("striker") == "registration"
        assert roster.covers("striker") and not roster.covers("tank")
