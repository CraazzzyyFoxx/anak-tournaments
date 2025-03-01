import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models


async def get_analytics(
    session: AsyncSession,
) -> typing.Sequence[
    tuple[models.Team, models.Player, models.Tournament, int, int, int, int, float]
]:
    pph = (
        sa.select(
            models.Player.user_id,
            models.Player.role,
            models.Player.team_id,
            sa.func.sum(models.Encounter.home_score).label("wins"),
            sa.func.sum(models.Encounter.away_score).label("losses"),
        )
        .join(models.Encounter, models.Player.team_id == models.Encounter.home_team_id)
        .join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
        .where(models.Tournament.id >= 21, models.Tournament.is_league.is_(False))
        .group_by(models.Player.user_id, models.Player.role, models.Player.team_id)
    ).cte("player_points_home")

    ppa = (
        sa.select(
            models.Player.user_id,
            models.Player.role,
            models.Player.team_id,
            sa.func.sum(models.Encounter.away_score).label("wins"),
            sa.func.sum(models.Encounter.home_score).label("losses"),
        )
        .join(models.Encounter, models.Player.team_id == models.Encounter.away_team_id)
        .join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
        .where(models.Tournament.id >= 21, models.Tournament.is_league.is_(False))
        .group_by(models.Player.user_id, models.Player.role, models.Player.team_id)
    ).cte("player_points_away")

    query = (
        sa.select(
            models.Team.id,
            models.Player,
            models.Tournament.id,
            sa.func.coalesce(pph.c.wins, 0) + sa.func.coalesce(ppa.c.wins, 0),
            sa.func.coalesce(pph.c.losses, 0) + sa.func.coalesce(ppa.c.losses, 0),
            sa.func.lag(models.Player.rank, 1).over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Tournament.id,
            ),
            sa.func.lag(models.Player.rank, 2).over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Tournament.id,
            ),
        )
        .join(models.Player, models.Team.id == models.Player.team_id)
        .join(models.Tournament, models.Player.tournament_id == models.Tournament.id)
        .join(
            pph,
            sa.and_(
                models.Player.user_id == pph.c.user_id,
                models.Player.role == pph.c.role,
                models.Player.team_id == pph.c.team_id,
            ),
            isouter=True,
        )
        .join(
            ppa,
            sa.and_(
                models.Player.user_id == ppa.c.user_id,
                models.Player.role == ppa.c.role,
                models.Player.team_id == ppa.c.team_id,
            ),
            isouter=True,
        )
        .where(
            models.Tournament.id >= 21,
            models.Tournament.is_league.is_(False),
            models.Player.is_substitution.is_(False),
        )
    )

    result = await session.execute(query)
    return result.all()  # type: ignore


async def get_matches(
    session: AsyncSession,
    start_range: int,
    end_range: int
) -> typing.Sequence[models.Encounter]:
    query = (
        sa.select(models.Encounter)
        .options(
            sa.orm.joinedload(models.Encounter.home_team),
            sa.orm.joinedload(models.Encounter.away_team),
            sa.orm.joinedload(models.Encounter.home_team).joinedload(models.Team.players),
            sa.orm.joinedload(models.Encounter.away_team).joinedload(models.Team.players),
            sa.orm.joinedload(models.Encounter.home_team).joinedload(models.Team.players).joinedload(models.Player.user),
            sa.orm.joinedload(models.Encounter.away_team).joinedload(models.Team.players).joinedload(models.Player.user),
            sa.orm.joinedload(models.Encounter.tournament),
        )
        .join(models.Tournament, models.Encounter.tournament_id == models.Tournament.id)
        .where(
            models.Encounter.tournament_id.between(start_range, end_range),
            # models.Tournament.is_league.is_(False),
        )
        .order_by(models.Encounter.tournament_id, models.Encounter.id)
    )
    result = await session.scalars(query)
    return result.unique().all()  # type: ignore


async def get_algorithm(session: AsyncSession, name: str) -> models.AnalyticsAlgorithm:
    query = sa.select(models.AnalyticsAlgorithm).where(models.AnalyticsAlgorithm.name == name)
    result = await session.execute(query)
    return result.scalar_one()  # type: ignore


async def get_players_by_tournament_id(
        session: AsyncSession, tournament_id: int
) -> typing.Sequence[models.AnalyticsPlayer]:
    query = (
        sa.select(models.AnalyticsPlayer)
        .join(models.Player, models.AnalyticsPlayer.player_id == models.Player.id)
        .where(models.AnalyticsPlayer.tournament_id == tournament_id)
    )
    result = await session.execute(query)
    return result.scalars().all()  # type: ignore