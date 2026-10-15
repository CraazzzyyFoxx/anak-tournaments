"""D33 export gate validates starter assignments and preserves non-rated leaves."""

from __future__ import annotations

import asyncio
import sys
from dataclasses import replace
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker

from shared import models
from shared.core.errors import ApiHTTPException
from shared.domain.team_format import FormatDimension, FormatRule, TeamFormat
from shared.repository.roles import CatalogRoleRepository
from shared.services.ontology import project_disciplines
from shared.services.team_export.materialization import MaterializationMember, MaterializationTeam, materialize_teams
from shared.services.team_format import save_tournament_format
from shared.testing import create_test_async_engine
from shared.testing.db import ensure_test_postgres


class TeamExportFormatTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self) -> None:
        ensure_test_postgres()
        self.engine = create_test_async_engine()
        self.session = async_sessionmaker(self.engine, expire_on_commit=False)()
        s = self.session
        await project_disciplines(s)
        workspace = models.Workspace(slug="export-format-test", name="Export format")
        s.add(workspace)
        await s.flush()
        self.tournament = models.Tournament(workspace_id=workspace.id, name="Export format", slug="export-format-test")
        dimension = models.RoleDimension(
            discipline="overwatch", code="communication", name="Communication", selection_mode="single", rated=False
        )
        s.add_all([self.tournament, dimension])
        await s.flush()
        self.shotcaller = models.CatalogRole(dimension_id=dimension.id, code="shotcaller", name="Shotcaller")
        s.add(self.shotcaller)
        self.members = []
        for name in ("Starter", "Bench"):
            user = models.User(name=name)
            s.add(user)
            await s.flush()
            member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
            s.add(member)
            await s.flush()
            self.members.append(
                MaterializationMember(
                    name=name,
                    rank=2000,
                    slot_code="tank",
                    workspace_member_id=member.id,
                    is_substitute=name == "Bench",
                )
            )
        await save_tournament_format(
            s,
            self.tournament,
            TeamFormat(
                "overwatch",
                "One starter",
                1,
                1,
                dimensions=(
                    FormatDimension("player_role", "enforced"),
                    FormatDimension("communication", "informational"),
                ),
                rules=(
                    FormatRule("player_role", "tank", hard_min=1, hard_max=1),
                    FormatRule("communication", "shotcaller", hard_min=1, hard_max=1),
                ),
            ),
        )

    async def asyncTearDown(self) -> None:
        await self.session.rollback()
        await self.session.close()
        await self.engine.dispose()

    async def test_missing_non_rated_assignment_blocks_before_writing_a_team(self) -> None:
        with self.assertRaises(ApiHTTPException) as caught:
            await materialize_teams(
                self.session,
                self.tournament.id,
                [
                    MaterializationTeam(
                        balancer_name="Roster",
                        members=tuple(self.members),
                    )
                ],
            )
        assert caught.exception.status_code == 409
        assert "team_format_violation" in str(caught.exception.detail)
        assert "role_below_hard_min" in str(caught.exception.detail)
        assert (
            await self.session.scalar(
                sa.select(sa.func.count())
                .select_from(models.Team)
                .where(models.Team.tournament_id == self.tournament.id)
            )
            == 0
        )

    async def test_bench_is_not_a_starter_and_every_assignment_is_written(self) -> None:
        starter = replace(self.members[0], non_rated_roles=(self.shotcaller,))
        outcome = await materialize_teams(
            self.session,
            self.tournament.id,
            [
                MaterializationTeam(
                    balancer_name="Roster",
                    members=(starter, self.members[1]),
                )
            ],
        )
        await self.session.flush()
        assert outcome.created_players == 2
        players = (
            await self.session.scalars(
                sa.select(models.Player).where(models.Player.tournament_id == self.tournament.id)
            )
        ).all()
        assigned = {player.name: {row.role.code for row in player.assignments} for player in players}
        assert assigned == {"Starter": {"tank", "shotcaller"}, "Bench": {"tank"}}
        assert {player.name: player.is_substitution for player in players} == {"Starter": False, "Bench": True}
        ontology = await CatalogRoleRepository().ontology(
            self.session, discipline="overwatch", workspace_id=self.tournament.workspace_id
        )
        assert ontology.by_id(self.shotcaller.id).dimension == "communication"
