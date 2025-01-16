import typing

import sqlalchemy as sa
from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..consts import overall_achievements, match_achievements, standing_achievements, divisions_achievements, team_achievements, heroes_achievements


__all__ = (
    "operators",
    "encounter_query",
    "get_or_create_achievement_if_not_exists",
    "bulk_initial_create_achievements",
    "get_achievement_or_log_error",
    "delete_user_achievements",
    "create_user_achievements",
    "home_score_case",
    "away_score_case",
)


operators = {
    "==": lambda left, right: left == right,
    ">=": lambda left, right: left >= right,
    ">": lambda left, right: left > right,
    "<=": lambda left, right: left <= right,
    "<": lambda left, right: left < right,
}

home_score_case = sa.case(
    (models.Encounter.home_team_id == models.Team.id, models.Encounter.home_score),
    else_=models.Encounter.away_score,
).label("home_score_case")
away_score_case = sa.case(
    (models.Encounter.home_team_id == models.Team.id, models.Encounter.away_score),
    else_=models.Encounter.home_score,
).label("away_score_case")

encounter_query = (
    sa.select(models.Player.id, home_score_case.label("home_score"), away_score_case.label("away_score"))
    .select_from(models.Player)
    .join(models.Team, models.Team.id == models.Player.team_id)
    .join(
        models.Encounter,
        sa.or_(models.Encounter.home_team_id == models.Team.id, models.Encounter.away_team_id == models.Team.id),
    )
).subquery("encounters")


async def get_or_create_achievement_if_not_exists(
    session: AsyncSession, slug: str, name: str, description_ru: str, description_en: str, hero_id: int | None = None
) -> models.Achievement:
    achievement_db = await session.scalar(sa.select(models.Achievement).filter_by(slug=slug))
    if achievement_db:
        logger.info(f"Achievement '{slug}' already exist. Skipping creation...")
        return achievement_db

    achievement = models.Achievement(
        name=name, slug=slug, description_ru=description_ru, description_en=description_en, hero_id=hero_id
    )
    session.add(achievement)
    await session.commit()
    return achievement


async def bulk_initial_create_achievements(session: AsyncSession) -> None:
    for achievement in [
        *overall_achievements,
        *match_achievements,
        *standing_achievements,
        *divisions_achievements,
        *team_achievements,
        *heroes_achievements
    ]:
        await get_or_create_achievement_if_not_exists(
            session=session,
            slug=achievement.slug,
            name=achievement.name,
            description_ru=achievement.description_ru,
            description_en=achievement.description_en,
        )


async def get_achievement_or_log_error(session: AsyncSession, slug: str) -> typing.Optional[models.Achievement]:
    achievement = await session.scalar(sa.select(models.Achievement).filter_by(slug=slug))
    if not achievement:
        logger.error(f"Achievement '{slug}' not found. Aborting...")
        return None
    return achievement


async def delete_user_achievements(
    session: AsyncSession,
    achievement: models.Achievement,
    tournament_id: int | None = None,
) -> None:
    stmt = sa.delete(models.AchievementUser).where(sa.and_(models.AchievementUser.achievement_id == achievement.id))
    if tournament_id is not None:
        stmt = stmt.where(sa.and_(models.AchievementUser.tournament_id == tournament_id))

    await session.execute(stmt)


async def create_user_achievements(
    session: AsyncSession,
    achievement: models.Achievement,
    users: list[int] | typing.Sequence[int],
    tournament_id: int | None = None,
    match_id: int | None = None,
) -> None:
    for user_id in users:
        user_achievement = models.AchievementUser(
            user_id=user_id, achievement_id=achievement.id, tournament_id=tournament_id, match_id=match_id
        )
        session.add(user_achievement)
