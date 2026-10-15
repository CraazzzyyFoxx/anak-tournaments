"""An encounter roster snapshots one leaf role per dimension (§14.3). Needs the test Postgres."""

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
from shared.repository import CatalogRoleRepository
from shared.services.encounter import participants
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres

_TAG = itertools.count()


class TeamMemberRoleTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        tag = f"tmr-{os.getpid()}-{next(_TAG)}"
        async with self.Session() as s:
            workspace = models.Workspace(slug=tag, name=tag)
            s.add(workspace)
            await s.flush()
            self.workspace_id = workspace.id
            damage = await CatalogRoleRepository().resolve(
                s, discipline="overwatch", workspace_id=None, dimension=None, code="damage"
            )
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
            self.tournament_id = tournament.id
            rule = models.ScoringRule(workspace_id=workspace.id, preset="wins", game_formula="win", end_formula="1")
            s.add(rule)
            await s.flush()
            self.encounter = models.Encounter(
                workspace_id=workspace.id,
                discipline="overwatch",
                tournament_id=tournament.id,
                scoring_rule_id=rule.id,
                name=tag,
                slot_count=2,
                status="PENDING",
            )
            s.add(self.encounter)
            user = models.User(name=tag)
            s.add(user)
            await s.flush()
            self.user_id = user.id
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
            s.add(member)
            await s.commit()
            self.member_id = member.id

    async def asyncTearDown(self) -> None:
        async with self.Session() as s:
            await s.execute(sa.delete(models.Encounter).where(models.Encounter.id == self.encounter.id))
            await s.execute(sa.delete(models.Tournament).where(models.Tournament.id == self.tournament_id))
            await s.execute(sa.delete(models.Workspace).where(models.Workspace.id == self.workspace_id))
            await s.execute(sa.delete(models.User).where(models.User.id == self.user_id))
            await s.commit()
        await self.engine.dispose()

    def _snapshot(self, roles):
        return participants.MemberSnapshot(
            workspace_member_id=self.member_id, display_name="m", rank=None, is_substitute=False, roles=roles
        )

    async def test_a_sub_role_is_one_leaf_row_read_back_as_its_codes(self) -> None:
        async with self.Session() as s:
            team = await participants.place_team(
                s,
                self.encounter,
                slot=1,
                team_id=None,
                name="A",
                seed=None,
                members=[self._snapshot((("player_role", "damage_hitscan"),))],
            )
            await s.commit()
            rows = (
                await s.scalars(
                    sa.select(models.EncounterTeamMemberRole)
                    .join(models.EncounterTeamMember)
                    .where(models.EncounterTeamMember.encounter_team_id == team.id)
                )
            ).all()
            assert [(row.dimension, row.role) for row in rows] == [("player_role", "damage_hitscan")]
            sql_rows = (
                await s.execute(
                    sa.select(models.EncounterTeamMemberRole.dimension, models.EncounterTeamMemberRole.role)
                    .select_from(models.EncounterTeamMemberRole)
                    .join(models.EncounterTeamMember)
                    .where(models.EncounterTeamMember.encounter_team_id == team.id)
                )
            ).all()
            assert [dict(row._mapping) for row in sql_rows] == [{"dimension": "player_role", "role": "damage_hitscan"}]
            assert rows[0].catalog_role.parent.code == "damage"

    async def test_an_unknown_role_is_refused(self) -> None:
        async with self.Session() as s:
            with self.assertRaises(BaseAPIException) as raised:
                await participants.place_team(
                    s,
                    self.encounter,
                    slot=1,
                    team_id=None,
                    name="A",
                    seed=None,
                    members=[self._snapshot((("player_role", "healer"),))],
                )
        assert raised.exception.status_code == 422
        assert "unknown_role" in raised.exception.detail

    async def test_a_substitute_resolves_the_encounters_leaf_role(self) -> None:
        async with self.Session() as s:
            team = await participants.place_team(
                s, self.encounter, slot=1, team_id=None, name="A", seed=None, members=[]
            )
            member = await participants.add_substitute(s, team, self._snapshot((("player_role", "damage_hitscan"),)))
            await s.commit()
            row = await s.scalar(
                sa.select(models.EncounterTeamMemberRole).where(
                    models.EncounterTeamMemberRole.team_member_id == member.id
                )
            )
            assert member.is_substitute
            assert row.catalog_role.code == "damage_hitscan"
            assert row.catalog_role.workspace_id == self.workspace_id

    async def test_a_role_from_another_workspace_or_dimension_is_refused(self) -> None:
        async with self.Session() as s:
            foreign = models.Workspace(slug=f"tmr-foreign-{self.workspace_id}", name="Other")
            s.add(foreign)
            await s.flush()
            damage = await CatalogRoleRepository().resolve(
                s, discipline="overwatch", workspace_id=None, dimension=None, code="damage"
            )
            s.add(
                models.CatalogRole(
                    dimension_id=damage.dimension_id,
                    workspace_id=foreign.id,
                    parent_role_id=damage.id,
                    code="damage_foreign",
                    name="Foreign",
                )
            )
            await s.flush()
            for dimension, code in (("player_role", "damage_foreign"), ("position", "damage")):
                with self.subTest(dimension=dimension, code=code), self.assertRaises(BaseAPIException) as raised:
                    async with s.begin_nested():
                        await participants.place_team(
                            s,
                            self.encounter,
                            slot=1,
                            team_id=None,
                            name="A",
                            seed=None,
                            members=[self._snapshot(((dimension, code),))],
                        )
                assert raised.exception.status_code == 422
                assert "unknown_role" in raised.exception.detail
