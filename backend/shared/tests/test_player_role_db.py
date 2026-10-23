"""Roster assignments read the same leaf in Python, SQL and wire responses (D86, D92)."""

from __future__ import annotations

import asyncio
import itertools
import os
import sys
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import BaseAPIException
from shared.models.tournament.player_role import assignment_of
from shared.repository import CatalogRoleRepository
from shared.schemas.role import RoleRef
from shared.services.ontology import project_disciplines, rated_leaf, resolve_role_ref
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class PlayerRoleTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"pr-{os.getpid()}-{next(_TAG)}"
        roles = CatalogRoleRepository()
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            damage = await roles.resolve(s, discipline="overwatch", workspace_id=None, dimension=None, code="damage")
            s.add(
                models.CatalogRole(
                    dimension_id=damage.dimension_id,
                    workspace_id=workspace.id,
                    parent_role_id=damage.id,
                    code="damage_hitscan",
                    name="Hitscan",
                )
            )
            tournament = models.Tournament(workspace_id=workspace.id, name=tag, slug=tag)
            s.add(tournament)
            await s.flush()
            team = models.Team(tournament_id=tournament.id, name=tag, balancer_name=tag)
            s.add(team)
            await s.flush()
            for key, (role, sub_role) in {
                "tank": ("tank", None),
                "hitscan": ("damage", "Hitscan"),
                "flex": ("flex", None),
            }.items():
                user = models.User(name=f"{tag}-{key}")
                s.add(user)
                await s.flush()
                member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
                s.add(member)
                await s.flush()
                leaf = await rated_leaf(
                    s, discipline="overwatch", workspace_id=workspace.id, role=role, sub_role=sub_role
                )
                s.add(
                    models.Player(
                        name=key,
                        rank=2000,
                        tournament_id=tournament.id,
                        team_id=team.id,
                        workspace_member_id=member.id,
                        assignments=[] if leaf is None else [assignment_of(leaf)],
                    )
                )
            await s.commit()
            self.tournament_id = tournament.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Tournament).where(models.Tournament.id == self.tournament_id))
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.commit()
        await self.engine.dispose()

    async def test_python_reads_the_top_level_role_and_the_sub_role(self) -> None:
        async with self.Session() as s:
            players = (
                await s.scalars(sa.select(models.Player).where(models.Player.tournament_id == self.tournament_id))
            ).all()
            await project_disciplines(s)
            lol_leaf = await resolve_role_ref(
                s,
                discipline="lol",
                workspace_id=self.workspace_id,
                ref=RoleRef(dimension="position", role="support"),
            )
            lol_player = models.Player(assignments=[assignment_of(lol_leaf)])
            assert lol_player.role_ref == RoleRef(dimension="position", role="support")
        assert {p.name: (p.role, p.sub_role) for p in players} == {
            "tank": ("tank", None),
            "hitscan": ("damage", "damage_hitscan"),
            "flex": (None, None),
        }
        assert {p.name: p.role_ref for p in players} == {
            "tank": RoleRef(dimension="player_role", role="tank"),
            "hitscan": RoleRef(dimension="player_role", role="damage_hitscan", parent="damage"),
            "flex": None,
        }

    async def test_sql_filters_groups_and_labels_by_the_same_values(self) -> None:
        async with self.Session() as s:
            rows = (
                await s.execute(
                    sa.select(models.Player.role, models.Player.sub_role, sa.func.count())
                    .where(models.Player.tournament_id == self.tournament_id, models.Player.role.is_not(None))
                    .group_by(models.Player.role, models.Player.sub_role)
                    .order_by(models.Player.role)
                )
            ).all()
        assert [(row.role, row.sub_role, row[2]) for row in rows] == [
            ("damage", "damage_hitscan", 1),
            ("tank", None, 1),
        ]

    async def test_a_sub_role_outside_the_workspace_is_refused_on_write(self) -> None:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as raised:
                await rated_leaf(
                    s, discipline="overwatch", workspace_id=self.workspace_id, role="damage", sub_role="projectile"
                )
        assert raised.exception.status_code == 422
        assert "unknown_sub_role" in str(raised.exception.detail)

    async def test_a_parentless_leaf_ref_resolves_and_a_foreign_dimension_is_refused(self) -> None:
        async with self.Session() as s:
            for parent in (None, "tank"):
                leaf = await resolve_role_ref(
                    s,
                    discipline="overwatch",
                    workspace_id=self.workspace_id,
                    ref=RoleRef(dimension="player_role", role="damage_hitscan", parent=parent),
                )
                assert (leaf.code, leaf.parent.code) == ("damage_hitscan", "damage")
            with self.assertRaises(BaseAPIException) as raised:
                await resolve_role_ref(
                    s,
                    discipline="overwatch",
                    workspace_id=self.workspace_id,
                    ref=RoleRef(dimension="position", role="support"),
                )
            assert raised.exception.status_code == 422
            assert "role_dimension_mismatch" in str(raised.exception.detail)
            with self.assertRaises(BaseAPIException) as raised:
                await resolve_role_ref(
                    s,
                    discipline="overwatch",
                    workspace_id=self.workspace_id,
                    ref=RoleRef(dimension="player_role", role="damage_hitscan"),
                    top_level_only=True,
                )
            assert raised.exception.status_code == 422
            assert "unknown_role" in str(raised.exception.detail)
