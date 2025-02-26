import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import enums, pagination
from src.services.hero import service as hero_service

from . import crud


async def create_hero_kd_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    heroes, total_heroes = await hero_service.get_all(
        session, pagination.PaginationParams(per_page=-1)
    )

    for hero in heroes:
        achievement = await crud.get_achievement_or_log_error(session, slug=hero.slug)
        if not achievement:
            continue

        await crud.delete_user_achievements(session, achievement, tournament.id)

        time_condition_subq = (
            sa.select(models.MatchStatistics.match_id, models.MatchStatistics.user_id)
            .where(
                sa.and_(
                    models.MatchStatistics.hero_id == hero.id,
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                    models.MatchStatistics.value >= 60,
                    models.MatchStatistics.round == 0,
                )
            )
            .group_by(models.MatchStatistics.match_id, models.MatchStatistics.user_id)
            .subquery()
        )

        query = (
            sa.select(
                models.MatchStatistics.user_id,
                sa.func.avg(
                    sa.case(
                        (
                            sa.and_(
                                models.MatchStatistics.name == enums.LogStatsName.KD
                            ),
                            models.MatchStatistics.value,
                        ),
                        else_=None,
                    )
                ).label("avg_kd"),
            )
            .select_from(models.Encounter)
            .join(models.Match, models.Encounter.id == models.Match.encounter_id)
            .join(
                models.MatchStatistics,
                models.MatchStatistics.match_id == models.Match.id,
            )
            .where(
                sa.and_(
                    models.Encounter.tournament_id == tournament.id,
                    models.MatchStatistics.hero_id == hero.id,
                    models.MatchStatistics.round == 0,
                    models.MatchStatistics.name.in_(
                        [enums.LogStatsName.KD, enums.LogStatsName.HeroTimePlayed]
                    ),
                    sa.exists(
                        sa.select(time_condition_subq.c.match_id).where(
                            sa.and_(
                                time_condition_subq.c.match_id
                                == models.MatchStatistics.match_id,
                                time_condition_subq.c.user_id
                                == models.MatchStatistics.user_id,
                            )
                        )
                    ),
                )
            )
            .group_by(models.MatchStatistics.user_id)
            .having(
                sa.and_(
                    sa.func.sum(
                        sa.case(
                            (
                                sa.and_(
                                    models.MatchStatistics.name
                                    == enums.LogStatsName.HeroTimePlayed
                                ),
                                models.MatchStatistics.value,
                            ),
                            else_=None,
                        )
                    )
                    > 600
                )
            )
            .order_by(sa.desc("avg_kd"))
        )

        result = await session.execute(query)
        user = result.first()

        if not user:
            logger.warning(
                f"User with best K/D for hero {hero.slug} not found. Skipping..."
            )
            continue

        user_achievement = models.AchievementUser(
            user_id=user[0], achievement_id=achievement.id, tournament_id=tournament.id
        )

        session.add(user_achievement)

    await session.commit()
    logger.info(
        f"Achievements for heroes K/D in tournament {tournament.name} created successfully"
    )


base_query_conditions = sa.and_(
    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
    models.MatchStatistics.value > 60,
    models.MatchStatistics.hero_id.isnot(None),
    models.MatchStatistics.round == 0,
)


async def calculate_freak_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "freak")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement)

    total_time_query = (
        sa.select(sa.func.sum(models.MatchStatistics.value))
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                base_query_conditions, models.Encounter.tournament_id == tournament.id
            )
        )
    )
    total_time_result = await session.execute(total_time_query)
    total_time = total_time_result.scalar() or 0

    if total_time <= 0:
        logger.info(
            f"No HeroTimePlayed found for tournament {tournament.name}. No freak achievements awarded."
        )
        return

    hero_time_subq = (
        sa.select(
            models.MatchStatistics.hero_id.label("hero_id"),
            sa.func.sum(models.MatchStatistics.value).label("hero_sum"),
        )
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(base_query_conditions)
        .group_by(models.MatchStatistics.hero_id)
        .subquery()
    )

    rare_heroes_subq = (
        sa.select(hero_time_subq.c.hero_id)
        .where(hero_time_subq.c.hero_sum < 0.001 * total_time)
        .subquery()
    )

    user_query = (
        sa.select(models.MatchStatistics.user_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                base_query_conditions,
                models.Encounter.tournament_id == tournament.id,
                models.MatchStatistics.hero_id.in_(sa.select(rare_heroes_subq)),
            )
        )
        .group_by(models.MatchStatistics.user_id)
    )

    user_result = await session.execute(user_query)
    user_ids = [row[0] for row in user_result.fetchall()]
    if not user_ids:
        logger.info(
            f"No users found who played sub-0.1% pickrate heroes in {tournament.name}."
        )
        return

    await crud.create_user_achievements(session, achievement, user_ids)

    await session.commit()
    logger.info(
        f"Achievements 'freak' created for {len(user_ids)} users in tournament '{tournament.name}'."
    )


async def calculate_mystery_heroes_achievements(
    session: AsyncSession, tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "mystery-heroes")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.MatchStatistics.user_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                base_query_conditions, models.Encounter.tournament_id == tournament.id
            )
        )
        .group_by(models.MatchStatistics.user_id)
        .having(sa.func.count(models.MatchStatistics.hero_id.distinct()) >= 7)
    )

    result = await session.scalars(query)
    users_ids = result.all()
    await crud.create_user_achievements(session, achievement, users_ids, tournament.id)
    await session.commit()

    logger.info(
        f"Achievements 'mystery-heroes' created for {len(users_ids)} users in tournament '{tournament.name}'"
    )


async def create_swiss_knife_achievements(session: AsyncSession) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "swiss-knife")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.MatchStatistics.user_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                base_query_conditions,
            )
        )
        .group_by(models.MatchStatistics.user_id)
        .having(sa.func.count(models.MatchStatistics.hero_id.distinct()) >= 20)
    )

    result = await session.execute(query)
    users_ids = [row[0] for row in result.all()]

    for user_id in users_ids:
        await crud.create_user_achievements(session, achievement, [user_id])

    await session.commit()
    logger.info(
        f"Achievements 'swiss-knife' created for {len(users_ids)} users in tournament"
    )
