import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from . import crud


async def calculate_to_bottom_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(session, "to-the-bottom")
    ):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Player.user_id.distinct())
        .select_from(models.Player)
        .join(models.Team, models.Player.team_id == models.Team.id)
        .join(models.Standing, models.Team.id == models.Standing.team_id)
        .where(
            sa.and_(
                models.Player.tournament_id == tournament.id,
                models.Standing.win == 0,
                models.Standing.draw == 0,
                models.Standing.buchholz.isnot(None),
            )
        )
    )

    result = await session.execute(query)
    users = result.scalars().all()

    await crud.create_user_achievements(session, achievement, users, tournament.id)
    await session.commit()
    logger.info(
        f"Achievements 'To bottom' for tournament {tournament.name} created successfully"
    )


async def calculate_beginners_are_lucky_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "beginners-are-lucky"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Team)
        .options(sa.orm.joinedload(models.Team.players))
        .join(models.Player, models.Team.id == models.Player.team_id)
        .join(models.Standing, models.Team.id == models.Standing.team_id)
        .join(models.Tournament, models.Team.tournament_id == models.Tournament.id)
        .where(
            sa.and_(
                models.Team.tournament_id == tournament.id,
                models.Standing.buchholz.is_(None),
                sa.or_(
                    sa.and_(
                        models.Tournament.number.between(5, 20),
                        models.Standing.overall_position < 7,
                    ),
                    sa.and_(
                        ~models.Tournament.number.between(5, 20),
                        models.Standing.overall_position < 13,
                    ),
                ),
            )
        )
        .group_by(models.Team.id)
        .having(
            sa.func.sum(sa.case((models.Player.is_newcomer.is_(True), 1), else_=0)) >= 1
        )
    )

    result = await session.scalars(query)
    for team in result.unique().all():
        for player in team.players:
            user_achievement = models.AchievementUser(
                user_id=player.user_id,
                achievement_id=achievement.id,
                tournament_id=tournament.id,
            )
            session.add(user_achievement)

    await session.commit()
    logger.info(
        f"Achievements 'Beginners are lucky' for tournament {tournament.name} created successfully"
    )


async def calculate_dirty_smurf_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(session, "dirty-smurf")
    ):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Player.user_id)
        .join(models.Standing, models.Player.team_id == models.Standing.team_id)
        .where(
            sa.and_(
                models.Player.tournament_id == tournament.id,
                models.Player.is_newcomer.is_(True),
                models.Standing.buchholz.is_(None),
                models.Standing.overall_position == 1,
            )
        )
    )

    result = await session.scalars(query)
    users = result.all()

    await crud.create_user_achievements(session, achievement, users, tournament.id)

    await session.commit()
    logger.info(
        f"Achievements 'Beginners are lucky' in tournament {tournament.name} for {len(users)} users created"
    )


async def calculate_samurai_has_no_purpose_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "samurai-has-no-purpose"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    OuterPlayer = sa.orm.aliased(models.Player)

    subquery = (
        sa.select(models.Team.id)
        .join(models.Standing, models.Team.id == models.Standing.team_id)
        .join(models.Player, models.Team.id == models.Player.team_id)
        .join(models.Tournament, models.Team.tournament_id == models.Tournament.id)
        .where(
            sa.or_(
                sa.and_(
                    models.Tournament.number.between(5, 20),
                    models.Standing.overall_position < 7,
                ),
                sa.and_(
                    ~models.Tournament.number.between(5, 20),
                    models.Standing.overall_position < 13,
                ),
            ),
            models.Tournament.is_league.is_(False),
            models.Player.user_id == OuterPlayer.user_id,
        )
    )

    query = sa.select(sa.distinct(OuterPlayer.user_id)).where(~sa.exists(subquery))

    result = await session.execute(query)
    users = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'Samurai has no purpose' created successfully")


async def calculate_consistent_winner_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "consistent-winner"
        )
    ):
        return

    sum_home = sa.func.sum(crud.encounter_query.c.home_score)
    sum_away = sa.func.sum(crud.encounter_query.c.away_score)
    winrate = sum_home / (sum_home + sum_away)

    query = (
        sa.select(models.User.id)
        .select_from(models.Player)
        .join(models.User, models.User.id == models.Player.user_id)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .join(crud.encounter_query, crud.encounter_query.c.id == models.Player.id)
        .where(
            sa.and_(
                models.Player.is_substitution.is_(False),
                models.Tournament.is_league.is_(False),
            ),
        )
        .group_by(models.User.id)
        .order_by(winrate.desc())
        .limit(20)
    )
    result = await session.execute(query)
    user_ids = result.scalars().all()
    await crud.create_user_achievements(session, achievement, user_ids)
    await session.commit()
    logger.info("Achievements 'Consistent winner' created successfully")


async def calculate_were_not_suckers_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "were-not-suckers"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    subquery = (
        sa.select(
            models.Encounter.tournament_id,
            sa.func.max(models.Encounter.round).label("max_round"),
        )
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Encounter.tournament_group_id,
        )
        .where(
            sa.and_(
                models.TournamentGroup.is_groups.is_(False),
            )
        )
        .group_by(models.Encounter.tournament_id)
        .subquery()
    )

    query = (
        sa.select(models.Encounter)
        .join(models.Tournament, models.Tournament.id == models.Encounter.tournament_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Encounter.tournament_group_id,
        )
        .join(
            subquery,
            sa.and_(
                subquery.c.tournament_id == models.Encounter.tournament_id,
                subquery.c.max_round == models.Encounter.round,
            ),
        )
        .options(
            sa.orm.joinedload(models.Encounter.home_team),
            sa.orm.joinedload(models.Encounter.away_team),
            sa.orm.joinedload(models.Encounter.home_team).joinedload(
                models.Team.players
            ),
            sa.orm.joinedload(models.Encounter.away_team).joinedload(
                models.Team.players
            ),
        )
    )

    result = await session.execute(query)
    users: dict[int, list[int]] = {}

    for encounter in result.unique().scalars().all():
        if encounter.home_score == 2 and encounter.away_score == 3:
            users.setdefault(encounter.tournament_id, [])
            users[encounter.tournament_id].extend(
                [
                    p.user_id
                    for p in encounter.home_team.players
                    if not p.is_substitution
                ]
            )
        elif encounter.home_score == 3 and encounter.away_score == 2:
            users.setdefault(encounter.tournament_id, [])
            users[encounter.tournament_id].extend(
                [
                    p.user_id
                    for p in encounter.away_team.players
                    if not p.is_substitution
                ]
            )

    for tournament_id, user_ids in users.items():
        await crud.create_user_achievements(
            session, achievement, user_ids, tournament_id
        )
    await session.commit()
    logger.info("Achievements 'We're not suckers' created successfully")


async def calculate_reverse_sweep_champion_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "reverse-sweep-champion"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    Enc = models.Encounter
    Tm = models.Team

    subq_lost_team_ids = (
        sa.select(Tm.id)
        .join(Enc, sa.or_(Enc.home_team_id == Tm.id, Enc.away_team_id == Tm.id))
        .where(
            sa.and_(
                Enc.tournament_id == tournament.id,
                sa.or_(
                    sa.and_(Enc.home_team_id == Tm.id, Enc.home_score < Enc.away_score),
                    sa.and_(Enc.away_team_id == Tm.id, Enc.away_score < Enc.home_score),
                ),
            )
        )
        .group_by(Tm.id)
        .subquery()
    )

    query = (
        sa.select(models.Player.user_id)
        .join(models.Team, models.Player.team_id == models.Team.id)
        .join(models.Standing, models.Team.id == models.Standing.team_id)
        .where(
            sa.and_(
                models.Standing.tournament_id == tournament.id,
                models.Standing.overall_position == 1,
                models.Standing.buchholz.is_(None),
                models.Team.id.in_(sa.select(subq_lost_team_ids)),
                models.Player.is_substitution.is_(False),
            )
        )
    )

    result = await session.execute(query)
    user_ids = result.scalars().all()

    await crud.create_user_achievements(session, achievement, user_ids, tournament.id)
    await session.commit()

    logger.info(
        f"Achievements 'win-lower-bracket' created successfully "
        f"for tournament '{tournament.name}' for {len(user_ids)} users."
    )


async def calculate_the_best_among_the_best_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "the-best-among-the-best"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)
    query = (
        sa.select(models.Player.user_id)
        .join(models.Standing, models.Player.team_id == models.Standing.team_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Standing.group_id,
        )
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            sa.and_(
                models.Player.tournament_id == tournament.id,
                models.TournamentGroup.is_groups.is_(True),
                models.Standing.win >= 5,
                models.Standing.lose == 0,
                models.Standing.draw == 0,
                models.Player.is_substitution.is_(False),
            )
        )
    )

    result = await session.execute(query)
    users_ids = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users_ids, tournament.id)
    await session.commit()
    logger.info(
        f"Achievements 'the-best-among-the-best' created successfully "
        f"for tournament '{tournament.name}' for {len(users_ids)} users."
    )


async def calculate_revenge_achievement(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    """
    Grants an achievement to users whose team won a match (Encounter E2)
    against a team that had previously beaten them (Encounter E1).

    Logic:
        - E1.id < E2.id   (the earlier match vs the later match)
        - same tournament_id
        - E1 and E2 must have the same pair of teams (home_team_id, away_team_id)
        - if E1 result = Team B beats Team A, and E2 result = Team A beats Team B
          => award the achievement to all players on the winning team of E2.

    Args:
        session: The AsyncSession for DB operations.
        tournament: The tournament we are checking.
    """

    achievement = await crud.get_achievement_or_log_error(session, "revenge-is-sweet")
    if not achievement:
        return

    # Remove old records (recalculation scenario)
    await crud.delete_user_achievements(session, achievement, tournament.id)

    E1 = sa.orm.aliased(models.Encounter)
    E2 = sa.orm.aliased(models.Encounter)

    # We define a condition that the SET of teams is the same in E1 and E2.
    # This can be expressed with an OR for "no side swap" or "side swap":
    same_teams_condition = sa.or_(
        sa.and_(
            sa.and_(
                E1.home_team_id == E2.home_team_id,
                E1.away_team_id == E2.away_team_id,
            ),
            sa.and_(E1.home_score > E1.away_score, E2.home_score < E2.away_score),
        ),
        sa.and_(
            sa.and_(
                E1.home_team_id == E2.away_team_id,
                E1.away_team_id == E2.home_team_id,
            ),
            sa.and_(E1.home_score > E1.away_score, E2.home_score < E2.away_score),
        ),
    )

    subquery = (
        sa.select(E2.id)
        .select_from(E1, E2)
        .where(
            sa.and_(
                E1.tournament_id == tournament.id,
                E2.tournament_id == tournament.id,
                E1.id < E2.id,  # E1 is earlier
                same_teams_condition,
            )
        )
        .distinct()
        .subquery("revenge_matches")
    )

    revenge_query = sa.select(models.Encounter).where(
        models.Encounter.id.in_(sa.select(subquery))
    )

    result = await session.execute(revenge_query)
    revenge_encounters = result.scalars().all()

    awarded_count = 0

    for enc in revenge_encounters:
        if enc.home_score > enc.away_score:
            winner_team_id = enc.home_team_id
        else:
            winner_team_id = enc.away_team_id

        players_query = sa.select(models.Player.user_id).where(
            sa.and_(models.Player.team_id == winner_team_id)
        )
        player_result = await session.execute(players_query)
        user_ids = [row[0] for row in player_result.all()]

        if user_ids:
            awarded_count += len(user_ids)
            await crud.create_user_achievements(
                session, achievement, user_ids, tournament.id
            )

    await session.commit()
    logger.info(
        f"Achievement 'revenge-is-sweet': Found {len(revenge_encounters)} revenge matches, "
        f"awarded to {awarded_count} total user(s)."
    )


async def calculate_win_with_20_div_achievement(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(
        session, "anchor-in-my-throat"
    )
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Team)
        .options(sa.orm.joinedload(models.Team.players))
        .join(models.Player, models.Team.id == models.Player.team_id)
        .join(models.Standing, models.Team.id == models.Standing.team_id)
        .where(
            sa.and_(
                models.Team.tournament_id == tournament.id,
                models.Player.div == 20,
                models.Standing.overall_position == 1,
                models.Standing.buchholz.is_(None),
            )
        )
    )

    result = await session.execute(query)
    team = result.unique().scalar()

    if team:
        user_ids = [player.user_id for player in team.players]
        await crud.create_user_achievements(
            session, achievement, user_ids, tournament.id
        )
        await session.commit()
        logger.info(
            f"Achievement 'anchor-in-my-throat' created for {len(user_ids)} users in tournament {tournament.name}"
        )


async def calculate_consecutive_wins_achievement(session: AsyncSession) -> None:
    """
    Grants an achievement to any user who has won 2 or more consecutive
    tournaments (non-league). "Consecutive" is determined by checking
    if the user won tournament_number = N and also N+1, etc.

    Logic:
      1) For each user, gather all tournaments where the user got 1st place
         (overall_position == 1, buchholz == None), ignoring league tournaments.
      2) Sort these winning tournaments by Tournament.number in ascending order.
      3) Use a window function to detect consecutive runs of tournament_number:
            group_id = tournament_number - row_number()
         so that e.g. (4,5,6) remain in one group if they are all in ascending order
         without skipping a number. If count(*) >= 2 in that group => user qualifies.
      4) Insert an achievement record for each user who meets the condition.

    Args:
        session: The AsyncSession used for database I/O.
    """

    achievement = await crud.get_achievement_or_log_error(
        session, "win-2-plus-consecutive"
    )
    if not achievement:
        return
    await crud.delete_user_achievements(session, achievement)

    row_number_expr = sa.func.row_number().over(
        partition_by=models.Player.user_id,  # each user separately
        order_by=models.Tournament.number.asc(),  # ascending order of tournament_number
    )

    # subquery (CTE) selecting user_id, the "tournament_number," and group_id
    # from the tournaments where they finished 1st place (and not league).
    winners_cte = (
        sa.select(
            models.Player.user_id.label("user_id"),
            models.Tournament.number.label("t_num"),
            # group_id = tournament_number - row_number()
            (models.Tournament.number - row_number_expr).label("group_id"),
        )
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(models.Standing, models.Standing.team_id == models.Team.id)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            sa.and_(
                models.Standing.overall_position == 1,
                models.Standing.buchholz.is_(None),  # final standing row
                models.Tournament.is_league.is_(False),  # ignore league tournaments
            )
        )
        .cte("winners_cte")
    )

    # 4) Now group by (user_id, group_id) and check if count(*) >= 2
    main_query = (
        sa.select(winners_cte.c.user_id)
        .group_by(winners_cte.c.user_id, winners_cte.c.group_id)
        .having(sa.func.count("*") >= 2)
    )

    result = await session.execute(main_query)
    rows = result.all()

    user_ids = [row[0] for row in rows]

    if not user_ids:
        logger.info("No users found with 2+ consecutive tournament wins.")
        return

    await crud.create_user_achievements(session, achievement, user_ids)

    await session.commit()

    logger.info(
        f"Achievement 'win-2-plus-consecutive': assigned to {len(user_ids)} user(s) who won 2+ tournaments in a row."
    )


async def calculate_five_second_day_streak_achievement(session: AsyncSession) -> None:
    """
    Awards an achievement to any user who has "exited to the second day"
    of 5 consecutive (non-league) tournaments.

    Definition of "exiting to the second day" here (example):
      - overall_position < 13,
      - buchholz IS NULL (a common indicator of final-stage or playoffs),
      - is_league = False.

    Steps:
      1) For each user, gather all tournaments in which they satisfied
         the "day two" condition.
      2) Sort these tournaments by an ascending numeric field (Tournament.number).
      3) Use a window function trick to detect consecutive tournament_numbers.
         Specifically: group_id = (tournament_number - row_number()).
         If a user has a group with count(*) >= 5, they earn the achievement.
      4) Insert a single achievement record per qualifying user.

    Args:
        session: AsyncSession for database operations.
    """

    # 1) Fetch the achievement record
    achievement = await crud.get_achievement_or_log_error(
        session, "five-second-day-streak"
    )
    if not achievement:
        return

    # 2) Delete old records if recalculating
    await crud.delete_user_achievements(session, achievement)

    # A typical row_number expression
    row_number_expr = sa.func.row_number().over(
        partition_by=models.Player.user_id, order_by=models.Tournament.number.asc()
    )

    # We only gather tournaments where the user "exited to the second day"
    # Condition: overall_position < 13, buchholz is None, is_league is False, etc.
    # Then define group_id = (Tournament.number - row_number).
    day2_cte = (
        sa.select(
            models.Player.user_id.label("user_id"),
            models.Tournament.number.label("t_num"),
            (models.Tournament.number - row_number_expr).label("group_id"),
        )
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(models.Standing, models.Standing.team_id == models.Team.id)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            sa.and_(
                sa.or_(
                    sa.and_(
                        models.Tournament.number.between(5, 20),
                        models.Standing.overall_position < 7,
                    ),
                    sa.and_(
                        ~models.Tournament.number.between(5, 20),
                        models.Standing.overall_position < 13,
                    ),
                ),
                models.Standing.buchholz.is_(None),
                models.Tournament.is_league.is_(False),
            )
        )
        .cte("day2_cte")
    )

    # Now we group by (user_id, group_id). If a user has 5+ tournaments in that group => success.
    main_query = (
        sa.select(day2_cte.c.user_id)
        .group_by(day2_cte.c.user_id, day2_cte.c.group_id)
        .having(sa.func.count("*") >= 5)
    )

    result = await session.execute(main_query)
    rows = result.fetchall()

    user_ids = [r[0] for r in rows]
    if not user_ids:
        logger.info("No users found with 5+ consecutive day-two finishes.")
        return

    await crud.create_user_achievements(session, achievement, user_ids)
    await session.commit()

    logger.info(
        f"Achievement 'five-second-day-streak': assigned to {len(user_ids)} user(s) "
        f"who made day two in 5 consecutive tournaments."
    )


async def calculate_lower_bracket_run_achievement(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "i-killed-i-stole")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Player.user_id)
        .join(models.Standing, models.Player.team_id == models.Standing.team_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Standing.group_id,
        )
        .join(
            models.Encounter,
            sa.or_(
                models.Encounter.home_team_id == models.Player.team_id,
                models.Encounter.away_team_id == models.Player.team_id,
            ),
        )
        .where(
            sa.and_(
                models.Player.tournament_id == tournament.id,
                models.Player.is_substitution.is_(False),
                models.Standing.overall_position.in_([1, 2]),
                models.Encounter.round < 0,
                models.TournamentGroup.is_groups.is_(False),
            )
        )
        .group_by(models.Player.user_id)
    )

    result = await session.execute(query)
    user_ids = result.scalars().all()
    await crud.create_user_achievements(session, achievement, user_ids, tournament.id)
    await session.commit()

    logger.info(
        f"Achievement 'i-killed-i-stole': assigned to {len(user_ids)} users in tournament {tournament.name}."
    )


async def calculate_well_balanced_achievements(session: AsyncSession, tournament: models.Tournament) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "well-balanced")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Player.user_id)
        .join(models.Team, models.Player.team_id == models.Team.id)
        .join(models.Standing, models.Team.id == models.Standing.team_id)
        .where(
            sa.and_(
                models.Player.tournament_id == tournament.id,
                models.Standing.draw == 5,
                models.Standing.win == 0,
                models.Standing.lose == 0,
                models.Standing.buchholz.isnot(None)
            )
        )
    )

    result = await session.execute(query)
    user_ids = result.scalars().all()
    await crud.create_user_achievements(session, achievement, user_ids, tournament.id)
    await session.commit()
    logger.info(
        f"Achievement 'well-balanced' created for tournament {tournament.name} for {len(user_ids)} users."
    )