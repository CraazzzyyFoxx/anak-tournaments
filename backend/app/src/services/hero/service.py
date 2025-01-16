import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import enums, pagination


async def get(session: AsyncSession, id: int) -> models.Hero | None:
    """
    Retrieves a hero by its ID.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the hero to retrieve.

    Returns:
        models.Hero | None: The Hero object if found, otherwise None.
    """
    query = sa.select(models.Hero).where(sa.and_(models.Hero.id == id))
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def get_by_name(session: AsyncSession, name: str) -> models.Hero | None:
    """
    Retrieves a hero by its name.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        name (str): The name of the hero to retrieve.

    Returns:
        models.Hero | None: The Hero object if found, otherwise None.
    """
    query = sa.select(models.Hero).where(sa.and_(models.Hero.name == name))
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def get_all(
    session: AsyncSession,
    params: pagination.SearchPaginationParams,
) -> tuple[typing.Sequence[models.Hero], int]:
    """
    Retrieves a paginated list of heroes based on search parameters.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.SearchPaginationParams): Search, pagination, and sorting parameters.

    Returns:
        tuple[typing.Sequence[models.Hero], int]: A tuple containing:
            - A sequence of Hero objects.
            - The total count of heroes.
    """
    query = sa.select(models.Hero)
    total_query = sa.select(sa.func.count(models.Hero.id))

    if params.query:
        query = params.apply_search(query, models.Hero)
        total_query = params.apply_search(total_query, models.Hero)

    query = params.apply_pagination_sort(query, models.Hero)

    result = await session.execute(query)
    total_result = await session.execute(total_query)
    return result.scalars().all(), total_result.scalar_one()


async def get_heroes_playtime(
    session: AsyncSession, params: schemas.HeroPlaytimePaginationParams
) -> tuple[typing.Sequence[tuple[models.Hero, float]], int]:
    """
    Retrieves a paginated list of heroes with their playtime statistics.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.HeroPlaytimePaginationParams): Pagination and filtering parameters.

    Returns:
        tuple[typing.Sequence[tuple[models.Hero, float]], int]: A tuple containing:
            - A sequence of tuples, each containing a Hero object and its playtime percentage.
            - The total count of heroes.
    """
    total_query = sa.select(sa.func.count(models.Hero.id))

    overall_play_time_query = (
        sa.select(sa.func.sum(models.MatchStatistics.value))
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.value > 60,
                models.MatchStatistics.hero_id.is_not(None),
                models.MatchStatistics.round == 0,
            )
        )
    )

    if params.user_id and params.user_id != "all":
        overall_play_time_query = overall_play_time_query.where(
            models.MatchStatistics.user_id == params.user_id
        )
    if params.tournament_id:
        overall_play_time_query = overall_play_time_query.where(
            models.Encounter.tournament_id == params.tournament_id
        )

    overall_play_time_result = await session.scalars(overall_play_time_query)
    overall_play_time = overall_play_time_result.one()

    query = (
        sa.select(
            models.Hero, sa.func.sum(models.MatchStatistics.value) / overall_play_time
        )
        .select_from(models.Hero)
        .join(models.MatchStatistics, models.MatchStatistics.hero_id == models.Hero.id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.value > 60,
                models.MatchStatistics.hero_id.is_not(None),
                models.MatchStatistics.round == 0,
            )
        )
        .group_by(models.Hero.id)
        .order_by(
            (sa.func.sum(models.MatchStatistics.value) / overall_play_time).desc()
        )
    )

    if params.user_id and params.user_id != "all":
        query = query.where(models.MatchStatistics.user_id == params.user_id)

    if params.tournament_id:
        query = query.where(models.Encounter.tournament_id == params.tournament_id)

    query = params.apply_pagination(query)
    result = await session.execute(query)
    total = await session.execute(total_query)
    return result.all(), total.scalar()  # type: ignore


async def get_heroes_stats(
    session: AsyncSession, params: schemas.HeroStatsPaginationParams
) -> tuple[typing.Sequence[tuple[models.Hero, float]], int]:
    """
    Retrieves a paginated list of heroes with their statistics for a specific stat.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.HeroStatsPaginationParams): Pagination and filtering parameters.

    Returns:
        tuple[typing.Sequence[tuple[models.Hero, float]], int]: A tuple containing:
            - A sequence of tuples, each containing a Hero object and its stat value.
            - The total count of heroes.
    """
    total_query = sa.select(sa.func.count(models.Hero.id))

    query = (
        sa.select(models.Hero, sa.func.sum(models.MatchStatistics.value))
        .select_from(models.Hero)
        .join(models.MatchStatistics, models.MatchStatistics.hero_id == models.Hero.id)
        .where(sa.and_(models.MatchStatistics.name == params.stat))
        .group_by(models.Hero.id)
        .order_by(sa.func.sum(models.MatchStatistics.value).desc())
    )

    query = params.apply_pagination(query)
    result = await session.execute(query)
    total = await session.execute(total_query)
    return result.all(), total.scalar()  # type: ignore
