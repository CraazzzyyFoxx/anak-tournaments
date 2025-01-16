import typing

import sqlalchemy as sa
from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import enums

from . import crud


async def find_match_by_criteria(
    session: AsyncSession,
    achievement_slug: str,
    tournament: models.Tournament,
    name: typing.Literal["closeness", "time"],
    operator: typing.Literal["==", ">=", ">", "<=", "<"],
    value: int,
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, achievement_slug)
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Match)
        .options(
            sa.orm.joinedload(models.Match.home_team),
            sa.orm.joinedload(models.Match.away_team),
            sa.orm.joinedload(models.Match.home_team).joinedload(models.Team.players),
            sa.orm.joinedload(models.Match.away_team).joinedload(models.Team.players),
        )
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                models.Encounter.tournament_id == tournament.id,
            )
        )
    )

    if name == "closeness":
        query = query.where(crud.operators[operator](models.Encounter.closeness, value))
    elif name == "time":
        query = query.where(crud.operators[operator](models.Match.time, value))

    result = await session.execute(query)
    matches = result.unique().scalars().all()

    counter = 0
    for match in matches:
        players = [*match.home_team.players, *match.away_team.players]
        user_ids = [player.user_id for player in players]

        counter += len(user_ids)
        await crud.create_user_achievements(session, achievement, user_ids, tournament.id, match.id)

    await session.commit()

    logger.info(
        f"Achievements '{achievement_slug}' in {tournament.name} created successfully for {counter} user(s)."
    )


async def calculate_balanced_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_criteria(session, "balanced", tournament, "closeness", "==", 0)


async def calculate_hard_game_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_criteria(session, "hard_game", tournament, "closeness", "==", 1)


async def calculate_7_years_in_azkaban_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_criteria(session, "7_years_in_azkaban", tournament, "time", ">=", 25*60)


async def calculate_fast_game_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_criteria(session, "fast", tournament, "time", "<=", 5*60)


async def find_match_by_stats_criteria(
    session: AsyncSession,
    achievement_slug: str,
    tournament: models.Tournament,
    log_stats_name: enums.LogStatsName,
    operator_str: typing.Literal["==", ">=", ">", "<=", "<"],
    value: int,
    win_required: bool = False,
) -> None:
    """
    Creates achievements for users who meet a certain criterion based on
    aggregated log statistics for each (user, match) pair.

    Grouping is strictly by (user_id, match_id).

    Args:
        session: AsyncSession used for DB access.
        achievement_slug: Slug of the achievement to assign.
        tournament: The tournament in which matches took place.
        log_stats_name: The statistic name (e.g. Kills, HeroTimePlayed, etc.).
        operator_str: Operator string (e.g. ">=") to compare the aggregated stats vs `value`.
        value: The numeric threshold for comparison.
        win_required: If True, the user's team must have won that match.

    Logic:
        1) Retrieve the specified achievement by slug.
        2) Remove old user-achievement records for this tournament (if any).
        3) Build a query:
           - SELECT (MatchStatistics.user_id, MatchStatistics.match_id).
           - JOIN Match -> Encounter to filter by tournament.id, round=0, and the chosen stats name.
           - If `win_required=True`, also JOIN Team and ensure that the user’s team won.
           - GROUP BY (user_id, match_id) only.
           - HAVING the sum of MatchStatistics.value meet the operator/value condition.
        4) For each (user_id, match_id) in the result, create a user-achievement record.
        5) Commit the changes.

    Example:
        If log_stats_name=LogStatsName.Kills, operator_str=">=", value=30, and win_required=True,
        we find users who accumulated at least 30 kills in a single match that they also won,
        and assign them the specified achievement.
    """

    # 1) Retrieve the achievement
    achievement = await crud.get_achievement_or_log_error(session, achievement_slug)
    if not achievement:
        return

    # 2) Remove old user-achievements for this tournament
    await crud.delete_user_achievements(session, achievement, tournament.id)

    # 3) Build the base query
    query = (
        sa.select(models.MatchStatistics.user_id, models.MatchStatistics.match_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(
            sa.and_(
                models.MatchStatistics.name == log_stats_name,
                models.Encounter.tournament_id == tournament.id,
                models.MatchStatistics.round == 0,
                models.MatchStatistics.hero_id.is_(None),
            )
        )
    )

    # Optionally ensure the user’s team won (join with Team)
    if win_required:
        query = query.join(models.Team, models.Team.id == models.MatchStatistics.team_id).where(
            sa.or_(
                sa.and_(
                    models.Encounter.home_team_id == models.Team.id,
                    models.Encounter.home_score > models.Encounter.away_score,
                ),
                sa.and_(
                    models.Encounter.away_team_id == models.Team.id,
                    models.Encounter.away_score > models.Encounter.home_score,
                ),
            )
        )
    # Build the HAVING clause for the aggregated statistic
    sum_expr = sa.func.sum(models.MatchStatistics.value)
    having_expr = crud.operators[operator_str](sum_expr, value)
    query = query.having(having_expr)
    query = query.group_by(models.MatchStatistics.match_id, models.MatchStatistics.user_id)

    result = await session.execute(query)
    rows = result.all()

    counter = 0
    for (user_id, match_id) in rows:
        counter += 1
        await crud.create_user_achievements(session, achievement, [user_id], tournament.id, match_id)

    await session.commit()

    logger.info(
        f"Achievements '{achievement_slug}' in {tournament.name} created successfully "
        f"for {counter} user(s). (win_required={win_required})"
    )


async def calculate_friendly_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(
        session,
        "friendly",
        tournament,
        enums.LogStatsName.Eliminations,
        "<=",
        0,
    )


async def calculate_boris_dick_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(
        session, "boris_dick", tournament, enums.LogStatsName.Deaths, "<=", 0, win_required=True
    )


async def calculate_just_dont_fuck_around_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(session, "just_dont_fuck_around", tournament, enums.LogStatsName.Deaths, ">=", 20)


async def calculate_john_wick_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(session, "john_wick", tournament, enums.LogStatsName.Eliminations, ">=", 60)


async def calculate_the_shift_factory_is_done_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await find_match_by_stats_criteria(
        session, "the-shift-factory-is-done", tournament, enums.LogStatsName.HealingDealt, ">=", 30000
    )


async def calculate_shooting_and_screaming_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(
        session, "shooting_and_screaming", tournament, enums.LogStatsName.HeroDamageDealt, ">=", 35000
    )


async def calculate_fiasko_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(session, "fiasko", tournament, enums.LogStatsName.EnvironmentalDeaths, ">=", 3)


async def calculate_boop_master_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(session, "boop_master", tournament, enums.LogStatsName.EnvironmentalKills, ">=", 3)


async def calculate_bullet_is_not_stupid_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    await find_match_by_stats_criteria(
        session, "bullet-is-not-stupid", tournament, enums.LogStatsName.ScopedCriticalHitKills, ">=", 10
    )