import typing

import sqlalchemy as sa
from loguru import logger

from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import enums

from . import crud


async def calculate_i_need_more_power_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "i-need-more-power"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)
    query = (
        sa.select(models.Player.user_id)
        .select_from(models.Player)
        .where(
            sa.and_(
                models.Player.tournament_id == tournament.id, models.Player.div <= 3
            )
        )
    )

    result = await session.scalars(query)
    users = result.all()

    await crud.create_user_achievements(session, achievement, users, tournament.id)
    await session.commit()
    logger.info(
        f"Achievements 'I need more power' for tournament {tournament.name} created successfully"
    )


async def calculate_captains_with_5_division_and_above_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement_dps = await session.scalar(
        sa.select(models.Achievement).filter_by(slug="damage-above-5-division")
    )
    achievement_tank = await session.scalar(
        sa.select(models.Achievement).filter_by(slug="tank-above-5-division")
    )
    achievement_support = await session.scalar(
        sa.select(models.Achievement).filter_by(slug="support-above-5-division")
    )

    achievement_map = {
        enums.HeroClass.damage: achievement_dps,
        enums.HeroClass.tank: achievement_tank,
        enums.HeroClass.support: achievement_support,
    }

    if not achievement_dps or not achievement_tank or not achievement_support:
        logger.error(
            "Achievement Captains with 5 division and above not found. Aborting..."
        )
        return

    for achievement in achievement_map.values():
        await crud.delete_user_achievements(session, achievement, tournament.id)

    query = (
        sa.select(models.Team)
        .options(sa.orm.joinedload(models.Team.players))
        .where(sa.and_(models.Team.tournament_id == tournament.id))
    )

    result = await session.scalars(query)
    for team in result.unique().all():
        for player in team.players:
            if player.user_id == team.captain_id and player.div <= 5:
                for player_ in team.players:
                    if player_.user_id != team.captain_id:
                        user_achievement = models.AchievementUser(
                            user_id=player_.user_id,
                            achievement_id=achievement_map[player.role].id,
                            tournament_id=tournament.id,
                        )
                        session.add(user_achievement)
                break

    await session.commit()
    logger.info(
        f"Achievements 'Captains with 5 division and above' for tournament {tournament.name} created successfully"
    )


async def calculate_div_achievements(
    session: AsyncSession,
    slug: str,
    difference: int,
    direction: typing.Literal["up", "down"] = "up",
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, slug)
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement)

    PlayerLag = (
        sa.select(
            models.Player.user_id.label("user_id"),
            models.Player.team_id.label("team_id"),
            models.Player.tournament_id.label("tournament_id"),
            models.Player.role.label("role"),
            models.Player.div.label("current_div"),
            sa.func.lag(models.Player.div)
            .over(
                partition_by=(models.Player.user_id, models.Player.role),
                order_by=models.Player.tournament_id,
            )
            .label("prev_div"),
        )
        .where(models.Player.is_substitution.is_(False))
        .order_by(
            models.Player.user_id, models.Player.role, models.Player.tournament_id
        )
        .cte("player_lag")
    )

    if direction == "up":
        condition = (PlayerLag.c.prev_div - PlayerLag.c.current_div) >= difference
    else:
        condition = (PlayerLag.c.current_div - PlayerLag.c.prev_div) >= difference

    main_query = sa.select(PlayerLag.c.user_id, PlayerLag.c.tournament_id).where(
        PlayerLag.c.prev_div.is_not(None), condition
    )

    result = await session.execute(main_query)
    rows = result.all()

    to_insert = []
    for user_id, t_id in rows:
        to_insert.append(
            models.AchievementUser(
                user_id=user_id, achievement_id=achievement.id, tournament_id=t_id
            )
        )
    session.add_all(to_insert)

    await session.commit()
    logger.info(
        f"Achievements '{slug}' created successfully for {len(to_insert)} users."
    )


async def calculate_my_strength_is_growing_achievements(session: AsyncSession) -> None:
    await calculate_div_achievements(
        session, slug="my-strength-is-growing", difference=1, direction="up"
    )


async def calculate_not_good_enough_achievements(session: AsyncSession) -> None:
    await calculate_div_achievements(
        session, slug="not-good-enough", difference=1, direction="down"
    )


async def calculate_balance_from_anak_achievements(session: AsyncSession) -> None:
    await calculate_div_achievements(
        session, slug="balance-from-anak", difference=4, direction="up"
    )


async def calculate_critical_failure_achievements(session: AsyncSession) -> None:
    await calculate_div_achievements(
        session, slug="critical-failure", difference=4, direction="down"
    )


async def calculate_my_drill_will_pierce_the_sky_achievements(
    session: AsyncSession,
) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "my-drill-will-pierce-the-sky"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    query = (
        sa.select(models.Player.user_id)
        .select_from(models.Player)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(sa.and_(models.Tournament.is_league.is_(False)))
        .group_by(models.Player.user_id, models.Player.role)
        .having(sa.func.max(models.Player.div) - sa.func.min(models.Player.div) >= 10)
    )

    result = await session.execute(query)
    users = result.scalars().all()
    await crud.create_user_achievements(session, achievement, users)
    await session.commit()
    logger.info("Achievements 'My drill will pierce the sky' created successfully")


async def calculate_im_fine_with_that_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(
            session, "im-fine-with-that"
        )
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    player_lag = (
        sa.select(
            models.Player.user_id.label("user_id"),
            models.Player.role.label("role"),
            models.Player.div.label("div"),
            models.Player.tournament_id.label("tournament_id"),
            sa.func.lag(models.Player.role)
            .over(
                partition_by=models.Player.user_id, order_by=models.Player.tournament_id
            )
            .label("prev_role"),
            sa.func.lag(models.Player.div)
            .over(
                partition_by=models.Player.user_id, order_by=models.Player.tournament_id
            )
            .label("prev_div"),
        )
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            models.Tournament.is_league.is_(False),
            models.Player.is_substitution.is_(False),
        )
        .order_by(models.Player.user_id, models.Player.tournament_id)
        .cte("player_lag")
    )

    player_changed = (
        sa.select(
            player_lag.c.user_id,
            player_lag.c.role,
            player_lag.c.div,
            player_lag.c.tournament_id,
            sa.case(
                (
                    sa.or_(
                        player_lag.c.prev_role.is_(None),
                        player_lag.c.prev_div.is_(None),
                        player_lag.c.prev_role != player_lag.c.role,
                        player_lag.c.prev_div != player_lag.c.div,
                    ),
                    1,
                ),
                else_=0,
            ).label("changed"),
        )
        .order_by(player_lag.c.user_id, player_lag.c.tournament_id)
        .cte("player_changed")
    )

    player_segments = (
        sa.select(
            player_changed.c.user_id,
            player_changed.c.role,
            player_changed.c.div,
            player_changed.c.tournament_id,
            sa.func.sum(player_changed.c.changed)
            .over(
                partition_by=player_changed.c.user_id,
                order_by=player_changed.c.tournament_id,
            )
            .label("segment_id"),
        ).order_by(player_changed.c.user_id, player_changed.c.tournament_id)
    ).cte("player_segments")

    main_query = (
        sa.select(player_segments.c.user_id.distinct())
        .group_by(player_segments.c.user_id, player_segments.c.segment_id)
        .having(sa.func.count("*") >= 7)
    )

    result = await session.execute(main_query)
    user_ids = result.scalars().all()

    await crud.create_user_achievements(session, achievement, user_ids)
    await session.commit()

    logger.info(
        f"Achievements 'im-fine-with-that' created successfully "
        f"for {len(user_ids)} user(s)."
    )
