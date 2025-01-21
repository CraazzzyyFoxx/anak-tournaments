from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination
from src.services.hero import flows as hero_flows
from src.services.tournament import flows as tournament_flows
from src.services.user import flows as user_flows

from . import service


async def to_pydantic(
    session: AsyncSession,
    achievement: models.Achievement,
    rarity: float,
    entities: list[str],
) -> schemas.AchievementRead:
    """
    Converts an Achievement model instance to a Pydantic schema (AchievementRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        achievement (models.Achievement): The Achievement model instance to convert.
        rarity (float): The rarity of the achievement.
        entities (list[str]): A list of related entities to include (e.g., ["hero"]).

    Returns:
        schemas.AchievementRead: The Pydantic schema representing the achievement.
    """
    hero = None
    if "hero" in entities and achievement.hero:
        hero = await hero_flows.to_pydantic(session, achievement.hero, [])

    return schemas.AchievementRead(
        **achievement.to_dict(),
        rarity=rarity,
        hero=hero,
    )


async def get(
    session: AsyncSession, achievement_id: int, entities: list[str]
) -> schemas.AchievementRead:
    """
    Retrieves an achievement by its ID and converts it to a Pydantic schema.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        achievement_id (int): The ID of the achievement to retrieve.
        entities (list[str]): A list of related entities to include (e.g., ["hero"]).

    Returns:
        schemas.AchievementRead: The Pydantic schema representing the achievement.

    Raises:
        errors.ApiHTTPException: If the achievement is not found.
    """
    achievement = await service.get(session, achievement_id, entities)

    if not achievement:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Achievement not found with id={achievement_id}",
                )
            ],
        )

    return await to_pydantic(session, achievement[0], achievement[1], entities)


async def get_all(
    session: AsyncSession, params: pagination.PaginationSortParams
) -> pagination.Paginated[schemas.AchievementRead]:
    """
    Retrieves a paginated list of achievements and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.PaginationSortParams): Pagination and sorting parameters.

    Returns:
        pagination.Paginated[schemas.AchievementRead]: A paginated list of Pydantic schemas representing the achievements.
    """
    achievements, total = await service.get_all(session, params)
    return pagination.Paginated(
        total=total,
        per_page=params.per_page,
        page=params.page,
        results=[
            await to_pydantic(session, achievement[0], achievement[1], params.entities)
            for achievement in achievements
        ],
    )


async def get_user_achievements(
    session: AsyncSession,
    user_id: int,
    entities: list[str],
) -> list[schemas.UserAchievementRead]:
    """
    Retrieves a list of achievements earned by a specific user and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        user_id (int): The ID of the user whose achievements are to be retrieved.
        entities (list[str]): A list of related entities to include (e.g., ["tournaments"]).

    Returns:
        list[schemas.UserAchievementRead]: A list of Pydantic schemas representing the user's achievements.
    """
    cache: dict[int, schemas.UserAchievementRead] = {}

    user = await user_flows.get(session, user_id, [])
    achievements = await service.get_user(session, user)

    for achievement, rarity in achievements:
        if achievement.achievement_id not in cache:
            cache[achievement.achievement_id] = schemas.UserAchievementRead(
                **achievement.achievement.to_dict(),
                rarity=rarity,
                count=1,
                tournaments_ids=(
                    [achievement.tournament_id] if achievement.tournament_id else []
                ),
                matches=[achievement.match_id] if achievement.match_id else [],
                tournaments=[],
                hero=None,
            )
        else:
            cache[achievement.achievement_id].count += 1
            if (
                achievement.tournament_id
                and achievement.tournament_id
                not in cache[achievement.achievement_id].tournaments
            ):
                cache[achievement.achievement_id].tournaments_ids.append(
                    achievement.tournament_id
                )
            if (
                achievement.match_id
                and achievement.match_id
                not in cache[achievement.achievement_id].matches
            ):
                cache[achievement.achievement_id].matches.append(achievement.match_id)

    if "tournaments" in entities:
        for achievement in cache.values():
            if achievement.tournaments_ids:
                for tournament_id in achievement.tournaments_ids:
                    tournament = await tournament_flows.get_read(
                        session, tournament_id, []
                    )
                    achievement.tournaments.append(tournament)

    return list(cache.values())
