import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models


async def get_algorithms(
    session: AsyncSession,
) -> typing.Sequence[models.AnalyticsAlgorithm]:
    query = sa.select(models.AnalyticsAlgorithm)
    result = await session.execute(query)
    return result.scalars().all()


async def get_algorithm(session: AsyncSession, id: int) -> models.AnalyticsAlgorithm:
    query = sa.select(models.AnalyticsAlgorithm).where(
        models.AnalyticsAlgorithm.id == id
    )
    result = await session.execute(query)
    return result.scalars().first()


async def get_analytics(
    session: AsyncSession, tournament_id: int, algorithm: models.AnalyticsAlgorithm
) -> typing.Sequence[
    tuple[models.Team, models.Player, models.AnalyticsShift, models.AnalyticsPlayer]
]:
    query = (
        sa.select(
            models.Team, models.Player, models.AnalyticsShift, models.AnalyticsPlayer
        )
        .options(
            sa.orm.joinedload(models.Team.standings),
            sa.orm.joinedload(models.Team.standings).joinedload(models.Standing.group),
        )
        .join(models.Player, models.Player.team_id == models.Team.id)
        .join(
            models.AnalyticsPlayer, models.AnalyticsPlayer.player_id == models.Player.id
        )
        .join(
            models.AnalyticsShift,
            sa.and_(
                models.AnalyticsShift.player_id == models.Player.id,
                models.AnalyticsShift.tournament_id == tournament_id,
                models.AnalyticsShift.algorithm_id == algorithm.id,
            ),
        )
        .where(
            models.Team.tournament_id == tournament_id,
        )
    )
    result = await session.execute(query)
    return result.unique().all()


async def change_shift(
    session: AsyncSession, team_id: int, player_id: int, shift: int
) -> tuple[models.AnalyticsPlayer, models.AnalyticsShift]:
    query = (
        sa.select(models.AnalyticsPlayer, models.AnalyticsShift)
        .join(
            models.AnalyticsShift,
            models.AnalyticsShift.player_id == models.AnalyticsPlayer.player_id,
        )
        .where(
            sa.and_(
                models.AnalyticsPlayer.player_id == player_id,
            )
        )
    )
    result = await session.execute(query)
    analytics, calculated_shift = result.first()

    analytics.shift = shift
    session.add(analytics)
    await session.commit()
    return analytics, calculated_shift
