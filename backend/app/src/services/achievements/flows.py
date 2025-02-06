import typing

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination
from src.services.hero import flows as hero_flows
from src.services.user import flows as user_flows
from src.services.encounter import flows as encounter_flows
from src.services.tournament import service as tournament_service
from src.services.tournament import flows as tournament_flows
from src.services.encounter import service as encounter_service

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
    count = None
    if "hero" in entities and achievement.hero:
        hero = await hero_flows.to_pydantic(session, achievement.hero, [])
    if "count" in entities:
        count = await service.get_count_users_achievements(session, [achievement.id])

    return schemas.AchievementRead(
        **achievement.to_dict(),
        rarity=rarity,
        hero=hero,
        count=count[achievement.id] if count else None,
    )


async def bulk_to_pydantic(
    session: AsyncSession,
    achievements: typing.Sequence[tuple[models.Achievement, float]],
    entities: list[str],
) -> list[schemas.AchievementRead]:
    """
    Converts a list of Achievement model instances to Pydantic schemas (AchievementRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        achievements (list[tuple[models.Achievement, float]]): A list of Achievement model instances and their rarity.
        entities (list[str]): A list of related entities to include (e.g., ["hero"]).

    Returns:
        list[schemas.AchievementRead]: A list of Pydantic schemas representing the achievements.
    """
    output: list[schemas.AchievementRead] = []
    count = None

    if "count" in entities:
        achievement_ids = [achievement.id for achievement, _ in achievements]
        count = await service.get_count_users_achievements(session, achievement_ids)

    for achievement, rarity in achievements:
        hero = None
        if "hero" in entities and achievement.hero:
            hero = await hero_flows.to_pydantic(session, achievement.hero, [])

        output.append(
            schemas.AchievementRead(
                **achievement.to_dict(),
                rarity=rarity,
                hero=hero,
                count=count[achievement.id] if count else None,
            )
        )

    return output


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
        results=await bulk_to_pydantic(session, achievements, params.entities),
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
                matches_ids=[achievement.match_id] if achievement.match_id else [],
                tournaments=[],
                matches=[],
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
                not in cache[achievement.achievement_id].matches_ids
            ):
                cache[achievement.achievement_id].matches_ids.append(
                    achievement.match_id
                )

    if "tournaments" in entities:
        for achievement in cache.values():
            if achievement.tournaments_ids:
                for tournament_id in achievement.tournaments_ids:
                    tournament = await tournament_flows.get_read(
                        session, tournament_id, []
                    )
                    achievement.tournaments.append(tournament)

    if "matches" in entities:
        for achievement in cache.values():
            if achievement.matches_ids:
                for match_id in achievement.matches_ids:
                    match = await encounter_flows.get_match(
                        session, match_id, ["map", "teams"]
                    )
                    achievement.matches.append(match)

    return list(cache.values())


async def get_achievement_users(
    session: AsyncSession, achievement_id: int, params: pagination.PaginationParams
) -> pagination.Paginated[schemas.AchievementEarned]:
    """
    Retrieves a paginated list of users who have earned a specific achievement.

    Args:
        session: AsyncSession: Database session to be used for retrieving data.
        achievement_id: int: Identifier for the achievement to filter users by.
        params: pagination.PaginationParams: Pagination parameters including page number and items per page.

    Returns:
        pagination.Paginated[schemas.AchievementEarned]: A paginated response containing a list of users and pagination details.
    """
    users, total = await service.get_users_achievements(session, achievement_id, params)
    results: list[schemas.AchievementEarned] = []
    tournament_to_fetch: list[int] = []
    matches_to_fetch: list[int] = []

    for user, count, last_tournament_id, last_match_id in users:
        if last_tournament_id:
            tournament_to_fetch.append(last_tournament_id)
        if last_match_id:
            matches_to_fetch.append(last_match_id)

    tournaments = await tournament_service.get_bulk_tournament(
        session, tournament_to_fetch, []
    )
    matches = await encounter_service.get_match_bulk(session, matches_to_fetch, ["encounter"])

    tournaments_map: dict[int, models.Tournament] = {tournament.id: tournament for tournament in tournaments}
    matches_map: dict[int, models.Match] = {match.id: match for match in matches}

    for user, count, last_tournament_id, last_match_id in users:
        last_tournament = None
        last_match = None
        if last_tournament_id:
            last_tournament = tournaments_map[last_tournament_id]
        if last_match_id:
            last_match = matches_map[last_match_id]

        results.append(
            schemas.AchievementEarned(
                user=await user_flows.to_pydantic(session, user, []),
                count=count,
                last_tournament=await tournament_flows.to_pydantic(
                    session, last_tournament, []
                )
                if last_tournament
                else None,
                last_match=await encounter_flows.to_pydantic_match(
                    session, last_match, ["encounter"]
                ) if last_match else None,
            )
        )

    return pagination.Paginated(
        total=total,
        per_page=params.per_page,
        page=params.page,
        results=results,
    )
