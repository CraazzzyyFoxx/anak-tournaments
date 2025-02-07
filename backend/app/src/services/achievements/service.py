import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models
from src.core import pagination, utils

# Subquery to count distinct users (players)
player_count_subq = (
    sa.select(sa.func.count(models.Player.user_id.distinct()))
).scalar_subquery()


def get_rarity_subq(achievement_id: int | None = None) -> sa.Subquery:
    """
    Generates a subquery to calculate the rarity of an achievement based on the number of users who have earned it.

    Parameters:
        achievement_id (int | None): The ID of the achievement to calculate rarity for. If None, calculates rarity for all achievements.

    Returns:
        sa.Subquery: A subquery that returns the achievement_id and its calculated rarity.
    """
    rarity_subq = sa.select(
        models.AchievementUser.achievement_id,
        (
            sa.func.count(sa.distinct(models.AchievementUser.user_id))
            / player_count_subq
        ).label("rarity"),
    ).group_by(models.AchievementUser.achievement_id)

    if achievement_id:
        rarity_subq = rarity_subq.where(
            sa.and_(models.AchievementUser.achievement_id == achievement_id)
        )

    return rarity_subq.subquery()


def achievement_entity(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    """
    Generates a list of SQLAlchemy loading options for related entities (e.g., hero) of an achievement.

    Parameters:
        in_entities (list[str]): A list of entity names to load (e.g., ["hero"]).
        child (typing.Any | None): Optional child entity for nested loading.

    Returns:
        list[_AbstractLoad]: A list of SQLAlchemy loading options.
    """
    entities = []
    if "hero" in in_entities:
        entities.append(utils.join_entity(child, models.Achievement.hero))

    return entities


async def get(
    session: AsyncSession, id: int, entities: list[str]
) -> tuple[models.Achievement, float] | None:
    """
    Retrieves an achievement by its ID along with its rarity.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the achievement to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["hero"]).

    Returns:
        tuple[models.Achievement, float] | None: A tuple containing the Achievement object and its rarity, or None if not found.
    """
    rarity_subq = get_rarity_subq(id)

    query = (
        sa.select(models.Achievement, rarity_subq.c.rarity)
        .filter_by(id=id)
        .options(*achievement_entity(entities))
        .join(rarity_subq, models.Achievement.id == rarity_subq.c.achievement_id)
    )

    result = await session.execute(query)

    return result.first()


async def get_all(
    session: AsyncSession, params: pagination.PaginationSortParams
) -> tuple[typing.Sequence[tuple[models.Achievement, float]], int]:
    """
    Retrieves a paginated list of all achievements along with their rarity and the total count of achievements.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.PaginationSortParams): Pagination and sorting parameters.

    Returns:
        tuple[typing.Sequence[tuple[models.Achievement, float]], int]: A tuple containing:
            - A list of tuples, each containing an Achievement object and its rarity.
            - The total count of achievements.
    """
    count_query = sa.select(sa.func.count(models.Achievement.id))
    rarity_subq = get_rarity_subq()
    query = (
        sa.select(models.Achievement, rarity_subq.c.rarity.label("rarity"))
        .options(*achievement_entity(params.entities))
        .join(rarity_subq, models.Achievement.id == rarity_subq.c.achievement_id)
    )
    query = params.apply_pagination_sort(query)
    count = await session.execute(count_query)
    results = await session.execute(query)
    return results.all(), count.scalar()  # type: ignore


async def get_count_users_achievements(
    session: AsyncSession, achievements_ids: list[int]
) -> dict[int, int]:
    """
    Retrieves the count of users who have earned each achievement in a list of achievement IDs.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        achievements_ids (list[int]): A list of achievement IDs.

    Returns:
        dict[int, int]: A dictionary mapping achievement IDs to the count of users who have earned them.
    """
    query = (
        sa.select(
            models.AchievementUser.achievement_id,
            sa.func.count(sa.distinct(models.AchievementUser.user_id)).label("count"),
        )
        .where(models.AchievementUser.achievement_id.in_(achievements_ids))
        .group_by(models.AchievementUser.achievement_id)
    )

    results = await session.execute(query)

    return {row[0]: row[1] for row in results.all()}


async def get_users_achievements(
    session: AsyncSession, achievement_id: int, params: pagination.PaginationParams
) -> list[tuple[models.User, int, int, int], int]:
    """
    Retrieves a paginated list of distinct users who have earned a specific achievement.

    Args:
        session: AsyncSession: The database session to execute the query.
        achievement_id: int: The ID of the achievement to fetch associated users for.
        params: pagination.PaginationParams: Parameters for pagination to limit and sort results.

    Returns:
        list[models.User]: A list of distinct User models associated with the given achievement.
    """
    total_query = sa.select(
        sa.func.count(sa.distinct(models.AchievementUser.user_id))
    ).where(models.AchievementUser.achievement_id == achievement_id)
    query = (
        sa.select(
            models.User,
            sa.func.count(models.AchievementUser.id).label("total"),
            sa.func.max(models.AchievementUser.tournament_id).label(
                "last_tournament_id"
            ),
            sa.func.max(models.AchievementUser.match_id).label(
                "last_match_id"
            )
        )
        .select_from(models.AchievementUser)
        .join(models.User, models.User.id == models.AchievementUser.user_id)
        .where(models.AchievementUser.achievement_id == achievement_id)
        .group_by(models.User.id)
        .order_by(sa.desc(sa.text("total")))
    )
    query = params.apply_pagination(query)
    results = await session.execute(query)
    total = await session.scalar(total_query)
    return [(result[0], result[1], result[2], result[3]) for result in results], total


async def get_user(
    session: AsyncSession, user: models.User
) -> typing.Sequence[tuple[models.AchievementUser, int]]:
    """
    Retrieves a list of achievements earned by a specific user along with their rarity.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        user (models.User): The user object for whom to retrieve achievements.

    Returns:
        typing.Sequence[tuple[models.AchievementUser, int]]: A list of tuples, each containing an AchievementUser object and the rarity of the achievement.
    """
    rarity_subq = (
        sa.select(
            models.AchievementUser.achievement_id,
            (
                sa.func.count(sa.distinct(models.AchievementUser.user_id))
                / player_count_subq
            ).label("rarity"),
        )
        .group_by(models.AchievementUser.achievement_id)
        .subquery()
    )

    query = (
        sa.select(models.AchievementUser, rarity_subq.c.rarity)
        .options(sa.orm.joinedload(models.AchievementUser.achievement))
        .join(
            rarity_subq,
            models.AchievementUser.achievement_id == rarity_subq.c.achievement_id,
        )
        .where(sa.and_(models.AchievementUser.user_id == user.id))
        .order_by(sa.asc(rarity_subq.c.rarity))
    )

    results = await session.execute(query)

    return results.all()
