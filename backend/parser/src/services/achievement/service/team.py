import sqlalchemy as sa
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import enums

from . import crud


async def calculate_lfs_4500_achievements(session: AsyncSession) -> None:
    if not (
        achievement := await crud.get_achievement_or_log_error(session, "lfs-4500")
    ):
        return

    await crud.delete_user_achievements(session, achievement)

    Player1 = sa.orm.aliased(models.Player)
    Player2 = sa.orm.aliased(models.Player)

    query = (
        sa.select(
            sa.func.least(Player1.user_id, Player2.user_id).label("user_id_1"),
            sa.func.greatest(Player1.user_id, Player2.user_id).label("user_id_2"),
            sa.func.count(sa.distinct(Player1.team_id)).label("same_team_count"),
        )
        .join(Player2, sa.and_(Player1.team_id == Player2.team_id))
        .filter(sa.and_(Player1.user_id != Player2.user_id))
        .group_by(
            sa.func.least(Player1.user_id, Player2.user_id),
            sa.func.greatest(Player1.user_id, Player2.user_id),
        )
        .having(sa.func.count(sa.distinct(Player1.team_id)) >= 3)
    )

    result = await session.execute(query)
    for user_id_1, user_id_2, _ in result.all():
        user_achievement = models.AchievementUser(
            user_id=user_id_1, achievement_id=achievement.id
        )
        session.add(user_achievement)
        user_achievement = models.AchievementUser(
            user_id=user_id_2, achievement_id=achievement.id
        )
        session.add(user_achievement)

    await session.commit()
    logger.info("Achievements 'LFS 4500' created successfully")


async def calculate_team_classes_achievements(
    session: AsyncSession,
    slug: str,
    tournament: models.Tournament,
    role: enums.HeroClass,
    primary: bool,
    secondary: bool,
    count: int,
) -> None:
    if not (achievement := await crud.get_achievement_or_log_error(session, slug)):
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    clause = [
        models.Player.role == role,
        models.Player.is_substitution.is_(False),
    ]

    if primary:
        clause.append(models.Player.primary.is_(True))

    if secondary:
        clause.append(models.Player.secondary.is_(True))

    query = (
        sa.select(models.Team)
        .options(sa.orm.joinedload(models.Team.players))
        .join(models.Player, models.Team.id == models.Player.team_id)
        .where(sa.and_(models.Team.tournament_id == tournament.id))
        .group_by(models.Team.id)
        .having(sa.func.sum(sa.case((sa.and_(*clause), 1), else_=0)) >= count)
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
        f"Achievements '{slug}' for tournament {tournament.name} created successfully"
    )


async def calculate_accuracy_is_above_all_else_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_team_classes_achievements(
        session=session,
        slug="accuracy-is-above-all-else",
        tournament=tournament,
        role=enums.HeroClass.damage,
        primary=True,
        secondary=False,
        count=2,
    )


async def calculate_simple_geometry_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_team_classes_achievements(
        session=session,
        slug="simple-geometry",
        tournament=tournament,
        role=enums.HeroClass.damage,
        primary=False,
        secondary=True,
        count=2,
    )


async def calculate_no_mercy_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_team_classes_achievements(
        session=session,
        slug="no_mercy",
        tournament=tournament,
        role=enums.HeroClass.support,
        primary=True,
        secondary=False,
        count=2,
    )


async def calculate_heal_for_a_fee_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    await calculate_team_classes_achievements(
        session=session,
        slug="heal_for_a_fee",
        tournament=tournament,
        role=enums.HeroClass.support,
        primary=False,
        secondary=True,
        count=2,
    )


def get_otp_users_subquery(tournament: models.Tournament):
    subquery = (
        sa.select(models.MatchStatistics.user_id)
        .join(models.Team, models.Team.id == models.MatchStatistics.team_id)
        .join(models.Match, models.Match.id == models.MatchStatistics.match_id)
        .where(
            sa.and_(
                models.MatchStatistics.round == 0,
                models.MatchStatistics.name == enums.LogStatsName.HeroTimePlayed,
                models.MatchStatistics.value > 60,
                models.MatchStatistics.hero_id.isnot(None),
                models.Team.tournament_id == tournament.id,
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
        .subquery()
    )

    return subquery


async def calculate_im_screwed_run_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "im-screwed-run")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    subquery_otp_users = get_otp_users_subquery(tournament)
    result = await session.execute(sa.select(subquery_otp_users.c.user_id))
    users = [row[0] for row in result.fetchall()]

    await crud.create_user_achievements(session, achievement, users, tournament.id)
    await session.commit()

    logger.info(
        f"Achievements 'im-screwed-run' created successfully "
        f"for tournament '{tournament.name}' for {len(users)} users."
    )


async def calculate_we_work_with_what_we_have_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(
        session, "we-work-with-what-we-have"
    )
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    subquery_otp_users = get_otp_users_subquery(tournament)
    subquery_teams_with_otp = (
        sa.select(models.Player.team_id).where(
            sa.and_(
                models.Player.user_id.in_(sa.select(subquery_otp_users.c.user_id)),
                models.Player.tournament_id == tournament.id,
            )
        )
    ).subquery()

    query = sa.select(models.Player.user_id).where(
        models.Player.team_id.in_(sa.select(subquery_teams_with_otp.c.team_id)),
        models.Player.is_substitution.is_(False),
    )

    result = await session.scalars(query)
    user_ids = result.all()

    await crud.create_user_achievements(session, achievement, user_ids, tournament.id)
    await session.commit()

    logger.info(
        f"Achievements 'we-work-with-what-we-have' created successfully "
        f"for tournament '{tournament.name}' for {len(user_ids)} users."
    )


async def calculate_were_so_fucked_achievements(
    session: AsyncSession, tournament: models.Tournament
) -> None:
    achievement = await crud.get_achievement_or_log_error(session, "were-so-fucked")
    if not achievement:
        return

    await crud.delete_user_achievements(session, achievement, tournament.id)

    subquery_otp_users = get_otp_users_subquery(tournament)
    subquery_teams_with_count_otp = (
        sa.select(
            models.Player.team_id.label("team_id"),
            sa.func.count(models.Player.user_id).label("otp_count"),
        )
        .join(subquery_otp_users, subquery_otp_users.c.user_id == models.Player.user_id)
        .where(models.Player.is_substitution.is_(False))
        .group_by(models.Player.team_id)
        .subquery()
    )

    subquery_teams_with_3_otp = (
        sa.select(subquery_teams_with_count_otp.c.team_id)
        .where(subquery_teams_with_count_otp.c.otp_count >= 3)
        .subquery()
    )

    query = sa.select(models.Player.user_id).where(
        models.Player.team_id.in_(sa.select(subquery_teams_with_3_otp.c.team_id))
    )

    result = await session.scalars(query)
    user_ids = result.all()

    await crud.create_user_achievements(session, achievement, user_ids, tournament.id)
    await session.commit()

    logger.info(
        f"Achievements 'were-so-fucked' created successfully "
        f"for tournament '{tournament.name}' for {len(user_ids)} users."
    )
