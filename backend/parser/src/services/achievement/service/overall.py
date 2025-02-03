import typing

import sqlalchemy as sa
from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import enums

from . import crud


async def calculate_welcome_to_club_achievements(session: AsyncSession) -> None:
    if not (achievement := await crud.get_achievement_or_log_error(session, "welcome")):
        return

    await crud.delete_user_achievements(session, achievement)

    query = sa.select(models.Player.user_id.distinct()).order_by(models.Player.user_id)
    result = await session.execute(query)
    users = result.scalars().all()

    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Welcome to club' created successfully")


async def calculate_captain_jack_sparrow_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "captain-jack-sparrow"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.Player.user_id)
        .select_from(models.Player)
        .join(models.Team, models.Player.team_id == models.Team.id)
        .where(models.Team.captain_id == models.Player.user_id)
    )

    result = await session.execute(query)
    users = result.unique().scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Captain Jack Sparrow' created successfully")


async def calculate_player_winrate_achievements(
    session: AsyncSession, slug: str, descending: bool, limit: int = 20
) -> None:
    if not (achievement := await crud.get_achievement_or_log_error(session, slug)):
        return

    await crud.delete_user_achievements(session, achievement)
    sum_home = sa.func.sum(crud.encounter_query.c.home_score)
    sum_away = sa.func.sum(crud.encounter_query.c.away_score)
    winrate = sum_home / (sum_home + sum_away)

    query = (
        sa.select(models.User.id)
        .select_from(models.Player)
        .join(models.User, models.User.id == models.Player.user_id)
        .join(crud.encounter_query, crud.encounter_query.c.id == models.Player.id)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            models.Player.is_substitution.is_(False),
            models.Tournament.is_league.is_(False),
        )
        .group_by(models.User.id)
        .order_by(
            winrate.desc() if descending else winrate.asc(),
            models.User.name,
        )
        .limit(limit)
    )

    result = await session.execute(query)
    user_ids = result.scalars().all()
    await crud.create_user_achievements(session, achievement, user_ids)
    await session.commit()
    logger.info(
        f"Achievements '{slug}' assigned successfully to {len(user_ids)} users."
    )


async def calculate_best_player_winrate_achievements(session: AsyncSession) -> None:
    await calculate_player_winrate_achievements(
        session=session, slug="best-player-winrate", descending=True, limit=20
    )


async def calculate_worst_player_winrate_achievements(session: AsyncSession) -> None:
    await calculate_player_winrate_achievements(
        session=session, slug="worst-player-winrate", descending=False, limit=20
    )


async def calculate_wins_achievement(
    session: AsyncSession,
    slug: str,
    required_position: int | None,
    required_value: int | float,
    operator_str: typing.Literal["==", ">=", ">", "<=", "<"] = ">=",
    group_by: typing.Literal["user", "tournament"] = "user",
    count_by: typing.Literal["user", "role", "win"] = "user",
) -> None:
    if not (achievement := await crud.get_achievement_or_log_error(session, slug)):
        return

    await crud.delete_user_achievements(session, achievement)

    if count_by == "user":
        count_expr = sa.func.count(models.Player.user_id)
    elif count_by == "role":
        count_expr = sa.func.count(models.Player.role.distinct())
    else:
        sum_home = sa.func.sum(crud.encounter_query.c.home_score)
        sum_away = sa.func.sum(crud.encounter_query.c.away_score)
        count_expr = sum_home / (sum_home + sum_away)

    having_clause = crud.operators[operator_str](count_expr, required_value)

    if group_by == "user":
        group_by_stmt = [models.Player.user_id]
        select_stmt = [models.Player.user_id]
    else:
        group_by_stmt = [models.Player.user_id, models.Player.tournament_id]
        select_stmt = [models.Player.user_id, models.Player.tournament_id]

    best_standing = (
        sa.select(
            models.Standing.id.label("standing_id"),
            models.Standing.team_id.label("team_id"),
            models.Standing.overall_position,
            sa.func.row_number()
            .over(
                partition_by=(models.Standing.team_id, models.Standing.tournament_id),
                order_by=(
                    sa.case((models.Standing.buchholz.is_(None), 1), else_=0).desc()
                ),
            )
            .label("rn"),
        )
        .select_from(models.Standing)
        .cte("best_standing")
    )

    only_best_standing = (
        sa.select(
            best_standing.c.standing_id,
            best_standing.c.team_id,
            best_standing.c.overall_position,
        ).where(
            best_standing.c.rn == 1,
        )
    ).cte("only_best_standing")

    query = (
        sa.select(*select_stmt)
        .select_from(models.Player)
        .join(models.Team, models.Player.team_id == models.Team.id)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .join(
            only_best_standing,
            sa.and_(
                only_best_standing.c.team_id == models.Team.id,
            ),
        )
        .where(
            sa.and_(
                models.Player.is_substitution.is_(False),
                models.Tournament.is_league.is_(False),
            )
        )
        .group_by(*group_by_stmt)
        .having(having_clause)
    )

    if required_position:
        query = query.where(
            sa.and_(only_best_standing.c.overall_position == required_position)
        )

    if count_by == "win":
        query = query.join(
            crud.encounter_query, crud.encounter_query.c.id == models.Player.id
        )

    result = await session.execute(query)
    user_ids = result.all()

    if group_by == "tournament":
        for user_id, tournament_id in user_ids:
            user_achievement = models.AchievementUser(
                user_id=user_id,
                achievement_id=achievement.id,
                tournament_id=tournament_id,
            )
            session.add(user_achievement)
    else:
        await crud.create_user_achievements(
            session, achievement, [user_id[0] for user_id in user_ids]
        )

    await session.commit()
    logger.info(
        f"Achievements '{slug}' created successfully for {len(user_ids)} users."
    )


async def calculate_honor_and_glory_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="honor-and-glory",
        required_value=1,
        required_position=1,
        operator_str=">=",
    )


async def calculate_two_wins_players_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="two-wins-players",
        required_value=2,
        required_position=1,
        operator_str="==",
    )


async def calculate_three_wins_players_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="three-wins-players",
        required_value=3,
        required_position=1,
        operator_str=">=",
    )


async def calculate_sisyphus_and_stone_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="sisyphus-and-stone",
        required_value=3,
        required_position=2,
        operator_str="==",
    )


async def calculate_dahao_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="dahao",
        required_value=2,
        required_position=1,
        operator_str="==",
        count_by="role",
    )


async def calculate_pathological_sucker_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="pathological-sucker",
        required_value=3,
        required_position=2,
        operator_str=">=",
        count_by="role",
    )


async def calculate_lord_of_all_the_elements_achievements(
    session: AsyncSession,
) -> None:
    await calculate_wins_achievement(
        session,
        slug="lord-of-all-the-elements",
        required_value=3,
        required_position=1,
        operator_str=">=",
        count_by="role",
    )


async def calculate_just_shooting_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="just-shooting",
        required_value=0.9,
        required_position=1,
        operator_str=">=",
        count_by="win",
        group_by="tournament",
    )


async def calculate_versatile_player_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="versatile-player",
        required_value=3,
        required_position=None,
        operator_str="==",
        count_by="role",
        group_by="user",
    )


async def calculate_fucking_casino_mouth(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="fucking-casino-mouth",
        required_value=20,
        required_position=None,
        operator_str=">=",
    )


async def calculate_regular_boar_achievements(session: AsyncSession) -> None:
    await calculate_wins_achievement(
        session,
        slug="regular-boar",
        required_value=30,
        required_position=None,
        operator_str=">=",
    )


async def calculate_old_achievements(session: AsyncSession) -> None:
    if not (achievement := await crud.get_achievement_or_log_error(session, "old")):
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.Player.user_id.distinct())
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            sa.and_(
                models.Tournament.is_league.is_(False), models.Tournament.number <= 18
            )
        )
    )

    result = await session.execute(query)
    users = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Old' created successfully")


async def calculate_young_blood_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(session, "young-blood")
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.Player.user_id.distinct())
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            sa.and_(
                models.Tournament.is_league.is_(False), models.Tournament.number > 18
            )
        )
    )

    result = await session.execute(query)
    users = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Young blood' created successfully")


async def calculate_backyard_cyber_athlete_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "backyard-cyber-athlete"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.Player.user_id.distinct())
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            models.Tournament.is_league.is_(True),
            models.Player.is_substitution.is_(False),
        )
    )

    result = await session.execute(query)
    users = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Backyard cyber athlete' created successfully")


async def calculate_its_genetics_achievements(session: AsyncSession) -> None:
    achievement = await session.scalar(
        sa.select(models.Achievement).filter_by(slug="its-genetics")
    )
    if not achievement:
        logger.error("Achievement Its genetics not found. Aborting...")
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.MatchStatistics.user_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .where(
            sa.and_(
                models.MatchStatistics.round == 0,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.value > 60,
                models.MatchStatistics.hero_id.isnot(None),
                models.Match.log_name.isnot(None),
            )
        )
        .group_by(models.MatchStatistics.user_id)
        .having(
            sa.and_(
                sa.func.count(sa.distinct(models.MatchStatistics.hero_id)) == 1,
                sa.func.count(sa.distinct(models.Match.id)) > 5,
            )
        )
    )

    result = await session.execute(query)
    users = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Its genetics' created successfully")


async def calculate_best_in_logs(
    session: AsyncSession,
    achievement_slug: str,
    log_stat_name: enums.LogStatsName,
    tournament: models.Tournament,
    order_by: typing.Literal["desc", "asc"] = "desc",
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, achievement_slug)
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    log_value = sa.func.sum(
        sa.case(
            (
                sa.and_(models.MatchStatistics.name == log_stat_name),
                models.MatchStatistics.value,
            ),
            else_=0,
        )
    )
    time_value = sa.func.sum(
        sa.case(
            (
                sa.and_(
                    models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed
                ),
                models.MatchStatistics.value,
            ),
            else_=0,
        )
    )

    order = sa.desc if order_by == "desc" else sa.asc

    query = (
        sa.select(models.MatchStatistics.user_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                models.MatchStatistics.name.in_(
                    [log_stat_name, enums.LogStatsName.HeroTimePlayed]
                ),
                models.Encounter.tournament_id == tournament.id,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.hero_id.is_(None),
            )
        )
        .group_by(models.MatchStatistics.user_id)
        .order_by(order(log_value / time_value))
        .limit(1)
    )

    result = await session.execute(query)
    user_id = result.scalar()

    if not user_id:
        logger.info(f"No user found for achievement '{achievement_slug}'.")
        return

    await crud.create_user_achievements(session, achievement, [user_id], tournament.id)
    await session.commit()
    logger.info(
        f"Achievements '{achievement_slug}' created successfully for 1 user(s)."
    )


async def calculate_ill_definitely_survive_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_best_in_logs(
        session,
        "ill-definitely-survive",
        enums.LogStatsName.Deaths,
        tournament,
        order_by="asc",
    )


async def calculate_killer_machine_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_best_in_logs(
        session,
        "killer-machine",
        enums.LogStatsName.Eliminations,
        tournament,
        order_by="desc",
    )


async def calculate_just_shoot_in_the_head_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_best_in_logs(
        session,
        "just-shoot-in-the-head",
        enums.LogStatsName.CriticalHitAccuracy,
        tournament,
        order_by="desc",
    )


async def calculate_poop_forever_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_best_in_logs(
        session,
        "poop_forever",
        enums.LogStatsName.HeroDamageDealt,
        tournament,
        order_by="desc",
    )


async def calculate_one_shot_one_kill_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_best_in_logs(
        session,
        "one-shot-one-kill",
        enums.LogStatsName.ScopedCriticalHitAccuracy,
        tournament,
        order_by="desc",
    )


async def calculate_sum_in_logs(
    session: AsyncSession,
    achievement_slug: str,
    log_stat_name: enums.LogStatsName,
    operator: typing.Literal["==", ">=", ">", "<=", "<"],
    value: int,
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, achievement_slug)
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.MatchStatistics.user_id)
        .where(
            sa.and_(
                models.MatchStatistics.name == log_stat_name,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.hero_id.is_(None),
            )
        )
        .group_by(models.MatchStatistics.user_id)
        .having(
            crud.operators[operator](sa.func.sum(models.MatchStatistics.value), value)
        )
    )

    result = await session.execute(query)
    user_ids = result.scalars().all()

    if not user_ids:
        logger.info(f"No user found for achievement '{achievement_slug}'.")
        return

    await crud.create_user_achievements(session, achievement, user_ids)
    await session.commit()
    logger.info(
        f"Achievements '{achievement_slug}' created successfully for {len(user_ids)} users."
    )


async def create_space_created_achievements(session: AsyncSession) -> None:
    await calculate_sum_in_logs(
        session, "space-created", enums.LogStatsName.Deaths, ">=", 1000
    )
