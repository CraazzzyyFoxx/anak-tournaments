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
    params: pagination.PaginationSortSearchParams,
) -> tuple[typing.Sequence[models.Hero], int]:
    """
    Retrieves a paginated list of heroes based on search parameters.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.PaginationSortSearchParams): Search, pagination, and sorting parameters.

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
) -> typing.Sequence[tuple[models.Hero, float]]:
    """
    Retrieves a paginated list of heroes with their playtime statistics.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.HeroPlaytimePaginationParams): Pagination and filtering parameters.

    Returns:
        typing.Sequence[tuple[models.Hero, float]]: A sequence of tuples, each containing a Hero object and its playtime percentage.
    """
    if params.user_id and params.user_id != "all":
        playtime_cte = (
            sa.select(
                models.MatchStatistics.hero_id,
                sa.func.sum(models.MatchStatistics.value).label("playtime"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.value > 60,
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.hero_id.isnot(None),
                    models.MatchStatistics.user_id == params.user_id,
                )
            )
            .group_by(models.MatchStatistics.hero_id)
        )
    else:
        playtime_cte = (
            sa.select(
                models.MatchStatistics.hero_id,
                sa.func.sum(models.MatchStatistics.value).label("playtime"),
            )
            .where(
                sa.and_(
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.value > 60,
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.hero_id.isnot(None),
                )
            )
            .group_by(models.MatchStatistics.hero_id)
        )

    if params.tournament_id:
        playtime_cte = (
            playtime_cte.join(
                models.Match, models.Match.id == models.MatchStatistics.match_id
            )
            .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
            .where(models.Encounter.tournament_id == params.tournament_id)
        )

    playtime_cte = playtime_cte.cte("playtime_cte")

    overall_play_time_subquery = (
        sa.select(
            sa.func.sum(playtime_cte.c.playtime).label("total_playtime")
        ).select_from(playtime_cte)
    ).scalar_subquery()

    query = (
        sa.select(
            models.Hero,
            (sa.func.sum(playtime_cte.c.playtime) / overall_play_time_subquery).label(
                "playtime"
            ),
        )
        .select_from(models.Hero)
        .join(playtime_cte, models.Hero.id == playtime_cte.c.hero_id)
        .group_by(models.Hero.id)
    )

    query = params.apply_sort(query)
    result = await session.execute(query)
    return result.all()


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


async def get_heroes_playtime_by_maps(
    session: AsyncSession, maps_ids: list[int], user_id: int
) -> typing.Sequence[tuple[models.Hero, int, float]]:
    overall_play_time_subquery = (
        sa.select(sa.func.sum(models.MatchStatistics.value))
        .select_from(models.Hero)
        .join(models.MatchStatistics, models.MatchStatistics.hero_id == models.Hero.id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.value > 60,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.user_id == user_id,
                models.Match.map_id.in_(maps_ids),
            )
        )
    )

    query = (
        sa.select(
            models.Hero,
            models.Match.map_id,
            (
                sa.func.sum(models.MatchStatistics.value)
                / overall_play_time_subquery.as_scalar()
            ).label("playtime"),
        )
        .select_from(models.Hero)
        .join(
            models.MatchStatistics,
            sa.and_(
                models.MatchStatistics.hero_id == models.Hero.id,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.value > 60,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.user_id == user_id,
            ),
        )
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(models.Match.map_id.in_(maps_ids))
        .group_by(models.Hero.id, models.Match.map_id)
        .order_by(sa.text("playtime DESC"))
    )

    result = await session.execute(query)
    return result.all()  # type: ignore
