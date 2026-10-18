"""Workspace-wide legacy achievements resolve OW history, not first-enabled LoL."""

import asyncio
import sys
import uuid
from datetime import UTC, datetime
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.models.achievements.achievement import (
    AchievementEvaluationResult,
    AchievementRule,
    EvaluationRunStatus,
    EvaluationRunTrigger,
)
from shared.repository.roles import CatalogRoleRepository
from shared.repository.workspace import WorkspaceRepository
from shared.services.division_grid import cache
from shared.testing import create_test_async_engine
from src.services.achievement.engine import runner


class LegacyAchievementGridTests(IsolatedAsyncioTestCase):
    if sys.platform == "win32":
        loop_factory = asyncio.SelectorEventLoop

    async def test_lol_first_workspace_keeps_real_ow_climb_award_before_and_after_lol_activation(self):
        engine = create_test_async_engine()
        tag = uuid.uuid4().hex
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                async with AsyncSession(
                    connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
                ) as session:
                    workspace = models.Workspace(slug=tag, name=tag, disciplines_enabled=["lol", "overwatch"])
                    user = models.User(name=tag)
                    session.add_all([workspace, user])
                    await session.flush()
                    member = models.WorkspaceMember(workspace_id=workspace.id, player_id=user.id)
                    session.add(member)
                    await session.flush()
                    ow = models.DivisionGridVersion(
                        grid=models.DivisionGrid(
                            workspace_id=workspace.id, discipline="overwatch", slug="ow", name="OW"
                        ),
                        version=1,
                        label="OW",
                        status="published",
                        tiers=[
                            models.DivisionGridTier(
                                slug="low", number=1, name="OW Low", sort_order=0, rank_min=0, rank_max=199, icon_url=""
                            ),
                            models.DivisionGridTier(
                                slug="high",
                                number=4,
                                name="OW High",
                                sort_order=1,
                                rank_min=200,
                                rank_max=None,
                                icon_url="",
                            ),
                        ],
                    )
                    lol = models.DivisionGridVersion(
                        grid=models.DivisionGrid(workspace_id=workspace.id, discipline="lol", slug="lol", name="LoL"),
                        version=1,
                        label="LoL",
                        status="published",
                        tiers=[
                            models.DivisionGridTier(
                                slug="lol", number=9, name="LoL", sort_order=0, rank_min=0, rank_max=None, icon_url=""
                            )
                        ],
                    )
                    session.add_all([ow, lol])
                    await session.flush()
                    await WorkspaceRepository().set_default_grid_version(
                        session, workspace, discipline="overwatch", version_id=ow.id
                    )
                    role = (
                        await CatalogRoleRepository().rated_rows(session, discipline="overwatch", workspace_id=None)
                    )["support"]
                    for month, rank in ((1, 100), (2, 300)):
                        tournament = models.Tournament(
                            workspace_id=workspace.id,
                            name=f"{tag}-{month}",
                            slug=f"{tag}-{month}",
                            discipline="overwatch",
                            start_date=datetime(2026, month, 1, tzinfo=UTC),
                        )
                        session.add(tournament)
                        await session.flush()
                        team = models.Team(tournament_id=tournament.id, name=tag, balancer_name=tag)
                        session.add(team)
                        await session.flush()
                        player = models.Player(
                            tournament_id=tournament.id,
                            team_id=team.id,
                            workspace_member_id=member.id,
                            name=tag,
                            rank=rank,
                            is_substitution=False,
                            is_newcomer=False,
                            is_newcomer_role=False,
                        )
                        session.add(player)
                        await session.flush()
                        session.add(
                            models.PlayerRole(player_id=player.id, dimension_id=role.dimension_id, role_id=role.id)
                        )
                    rule = AchievementRule(
                        workspace_id=workspace.id,
                        slug="climb",
                        name="Climb",
                        description_ru="Climb",
                        description_en="Climb",
                        discipline="overwatch",
                        category="division",
                        scope="global",
                        grain="user",
                        condition_tree={"type": "div_span", "params": {"op": ">=", "value": 3}},
                        depends_on=[],
                        enabled=True,
                    )
                    session.add(rule)
                    await session.flush()
                    for has_lol in (False, True):
                        if has_lol:
                            await WorkspaceRepository().set_default_grid_version(
                                session, workspace, discipline="lol", version_id=lol.id
                            )
                        await cache.invalidate_workspace(workspace.id)
                        run = await runner.run_evaluation(
                            session, workspace.id, EvaluationRunTrigger.parse_complete, rule_ids=[rule.id]
                        )
                        assert run.status == EvaluationRunStatus.done, run.error_message
                        assert run.rules_evaluated == 1
                        awards = (
                            await session.scalars(
                                sa.select(AchievementEvaluationResult).where(
                                    AchievementEvaluationResult.achievement_rule_id == rule.id
                                )
                            )
                        ).all()
                        assert len(awards) == 1
                        assert awards[0].workspace_member_id == member.id
                        print(
                            f"PostgreSQL OW achievement: enabled=[lol,overwatch], LoL assigned={has_lol}, climb=3, persisted awards=1"
                        )
            finally:
                await transaction.rollback()
            assert (
                await connection.scalar(
                    sa.select(sa.func.count()).select_from(models.Workspace).where(models.Workspace.slug == tag)
                )
                == 0
            )
            print("ROLLBACK confirmed: achievement smoke workspace rows=0")
        await engine.dispose()
