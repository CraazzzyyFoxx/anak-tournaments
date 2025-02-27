import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models, schemas
from src.core import enums, utils


def tournament_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    """
    Constructs a list of SQLAlchemy load options for querying related entities of a `Tournament` model.

    Args:
        in_entities: A list of strings representing the names of related entities to load.
        child: An optional SQLAlchemy relationship or join entity to chain the load options.

    Returns:
        A list of SQLAlchemy load options (`_AbstractLoad`) for the specified entities.
    """
    entities = []
    if "groups" in in_entities:
        entities.append(utils.join_entity(child, models.Tournament.groups))
    return entities


async def get(
    session: AsyncSession, id: int, entities: list[str]
) -> models.Tournament | None:
    """
    Retrieves a `Tournament` model instance by its ID, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the tournament to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `Tournament` model instance if found, otherwise `None`.
    """
    query = (
        sa.select(models.Tournament)
        .where(sa.and_(models.Tournament.id == id))
        .options(*tournament_entities(entities))
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def get_group(
    session: AsyncSession, id: int, entities: list[str]
) -> models.TournamentGroup | None:
    """
    Retrieves a `TournamentGroup` model instance by its ID.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the tournament group to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `TournamentGroup` model instance if found, otherwise `None`.
    """
    query = sa.select(models.TournamentGroup).where(
        sa.and_(models.TournamentGroup.id == id)
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def get_by_number_and_league(
    session: AsyncSession, number: int, is_league: bool, entities: list[str]
) -> models.Tournament | None:
    """
    Retrieves a `Tournament` model instance by its number and league status, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        number: The number of the tournament to retrieve.
        is_league: Whether the tournament is a league.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `Tournament` model instance if found, otherwise `None`.
    """
    query = (
        sa.select(models.Tournament)
        .where(
            sa.and_(
                models.Tournament.number == number,
                models.Tournament.is_league == is_league,
            )
        )
        .options(*tournament_entities(entities))
    )
    result = await session.execute(query)
    return result.unique().scalars().first()


async def get_all(
    session: AsyncSession, params: schemas.TournamentPaginationSortSearchParams
) -> tuple[typing.Sequence[models.Tournament], int]:
    """
    Retrieves a paginated list of `Tournament` model instances based on filtering and sorting parameters.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        params: An instance of `SearchPaginationParams` containing pagination, sorting, and filtering parameters.

    Returns:
        A tuple containing:
        1. A sequence of `Tournament` model instances.
        2. The total count of tournaments matching the filtering criteria.
    """
    query = sa.select(models.Tournament).options(*tournament_entities(params.entities))
    total_query = sa.select(sa.func.count(models.Tournament.id))
    query = params.apply_pagination_sort(query, models.Tournament)
    query = params.apply_search(query, models.Tournament)
    total_query = params.apply_search(total_query, models.Tournament)

    if params.is_league is not None:
        query = query.where(models.Tournament.is_league.is_(params.is_league))
        total_query = total_query.where(
            models.Tournament.is_league.is_(params.is_league)
        )

    result = await session.execute(query)
    total_result = await session.execute(total_query)
    return result.unique().scalars().all(), total_result.scalar_one()


async def get_history_tournaments(
    session: AsyncSession,
) -> typing.Sequence[tuple[models.Tournament, int, float, float]]:
    """
    Retrieves historical statistics for tournaments, including player count, average SR, and average closeness.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A sequence of tuples containing:
        1. A `Tournament` model instance.
        2. The number of players in the tournament.
        3. The average SR of teams in the tournament.
        4. The average closeness of encounters in the tournament.
    """
    players_count = (
        (
            sa.select(sa.func.count(models.Player.user_id)).where(
                models.Player.tournament_id == models.Tournament.id,
                models.Tournament.number.isnot(None),
            )
        )
        .scalar_subquery()
        .correlate(models.Tournament)
    )

    avg_sr = (
        (
            sa.select(sa.func.avg(models.Team.avg_sr)).where(
                models.Team.tournament_id == models.Tournament.id,
                models.Tournament.number.isnot(None),
            )
        )
        .scalar_subquery()
        .correlate(models.Tournament)
    )

    avg_closeness = (
        (
            sa.select(sa.func.avg(models.Encounter.closeness)).where(
                models.Encounter.tournament_id == models.Tournament.id,
                models.Tournament.number.isnot(None),
            )
        )
        .scalar_subquery()
        .correlate(models.Tournament)
    )

    query = (
        sa.select(models.Tournament, players_count, avg_sr, avg_closeness)
        .where(models.Tournament.number.isnot(None))
        .group_by(models.Tournament.id)
        .order_by(models.Tournament.number)
    )
    result = await session.execute(query)
    return result.all()  # type: ignore


async def get_avg_div_tournaments(
    session: AsyncSession,
) -> typing.Sequence[tuple[models.Tournament, enums.HeroClass, float]]:
    """
    Retrieves average division statistics for tournaments by role.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A sequence of tuples containing:
        1. A `Tournament` model instance.
        2. The role (e.g., tank, damage, support).
        3. The average division for the role in the tournament.
    """
    query = (
        sa.select(models.Tournament, models.Player.role, sa.func.avg(models.Player.div))
        .where(
            models.Player.tournament_id == models.Tournament.id,
            models.Tournament.number.isnot(None),
        )
        .group_by(models.Tournament.id, models.Player.role)
        .order_by(models.Tournament.number)
    )
    result = await session.execute(query)
    return result.all()  # type: ignore


async def get_tournaments_overall(session: AsyncSession) -> tuple[int, int, int, int]:
    """
    Retrieves overall statistics for tournaments, including counts of tournaments, teams, players, and champions.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A tuple containing:
        1. The total number of tournaments.
        2. The total number of teams.
        3. The total number of players.
        4. The total number of champions.
    """
    tournaments_count_query = sa.select(sa.func.count(models.Tournament.id)).where(
        models.Tournament.is_league.is_(False)
    )

    teams_count_query = (
        sa.select(sa.func.count(models.Team.id))
        .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
        .where(models.Tournament.is_league.is_(False))
    )

    players_count_query = (
        sa.select(sa.func.count(sa.distinct(models.Player.user_id)))
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(models.Tournament.is_league.is_(False))
    )

    champions_count_query = (
        sa.select(sa.func.count(models.Player.user_id.distinct()))
        .select_from(models.Player)
        .join(models.Standing, models.Standing.team_id == models.Player.team_id)
        .join(
            models.TournamentGroup,
            models.TournamentGroup.id == models.Standing.group_id,
        )
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(
            sa.and_(
                models.Standing.overall_position == 1,
                models.TournamentGroup.is_groups.is_(False),
                models.Player.is_substitution.is_(False),
                models.Tournament.is_league.is_(False),
            )
        )
    )
    tournaments_count_result = await session.execute(tournaments_count_query)
    teams_count_result = await session.execute(teams_count_query)
    players_count_result = await session.execute(players_count_query)
    champions_count_result = await session.execute(champions_count_query)
    return (
        tournaments_count_result.scalar_one(),
        teams_count_result.scalar_one(),
        players_count_result.scalar_one(),
        champions_count_result.scalar_one(),
    )


async def get_owal_standings(
    session: AsyncSession,
) -> typing.Sequence[tuple[models.User, models.Team, models.Tournament, models.Player]]:
    """
    Retrieves OWAL (Overwatch Anak League) standings.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A sequence of tuples containing:
        1. A `User` model instance.
        2. A `Team` model instance.
        3. A `Tournament` model instance.
        4. A `Player` model instance.
    """
    query = (
        sa.select(models.User, models.Team, models.Tournament, models.Player)
        .options(
            sa.orm.joinedload(models.Team.standings),
        )
        .select_from(models.Player)
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .join(models.Team, models.Team.id == models.Player.team_id)
        .join(models.User, models.User.id == models.Player.user_id)
        .where(
            sa.and_(
                models.Tournament.is_league.is_(True),
                models.Tournament.name.startswith("OWAL Season 2"),
                models.Player.is_substitution.is_(False),
                models.Tournament.is_finished.is_(True),
            )
        )
    )
    result = await session.execute(query)
    return result.unique().all()


async def get_owal_days(session: AsyncSession) -> typing.Sequence[models.Tournament]:
    """
    Retrieves OWAL (Overwatch Anak League) days.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A sequence of `Tournament` model instances representing OWAL days.
    """
    query = (
        sa.select(models.Tournament)
        .where(
            sa.and_(
                models.Tournament.is_league.is_(True),
                models.Tournament.name.startswith("OWAL Season 2"),
            )
        )
        .order_by(models.Tournament.start_date)
    )
    result = await session.execute(query)
    return result.unique().scalars().all()


async def get_bulk_tournament(
    session: AsyncSession, tournaments_ids: list[int], entities: list[str]
) -> typing.Sequence[models.Tournament]:
    """
    Retrieves a list of `Tournament` model instances by their IDs.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        tournaments_ids: A list of tournament IDs to retrieve.

    Returns:
        A sequence of `Tournament` model instances.
    """
    query = (
        sa.select(models.Tournament)
        .options(*tournament_entities(entities))
        .where(models.Tournament.id.in_(tournaments_ids))
    )
    result = await session.execute(query)
    return result.scalars().all()


async def get_analytics(
    session: AsyncSession, tournament_id: int, algorithm: str = "points"
) -> typing.Sequence[tuple[models.Team, models.Player, models.TournamentAnalytics]]:
    query = (
        sa.select(
            models.Team,
            models.Player,
            models.TournamentAnalytics,
        )
        .select_from(models.TournamentAnalytics)
        .options(
            sa.orm.joinedload(models.Team.standings),
            sa.orm.joinedload(models.Team.standings).joinedload(models.Standing.group),
        )
        .join(models.Team, models.Team.id == models.TournamentAnalytics.team_id)
        .join(models.Player, models.Player.id == models.TournamentAnalytics.player_id)
        .where(
            models.TournamentAnalytics.tournament_id == tournament_id,
            models.TournamentAnalytics.algorithm == algorithm,
        )
    )
    result = await session.execute(query)
    return result.unique().all()


async def change_shift(
    session: AsyncSession, team_id: int, player_id: int, shift: int
) -> models.TournamentAnalytics:
    query = sa.select(models.TournamentAnalytics).where(
        sa.and_(
            models.TournamentAnalytics.team_id == team_id,
            models.TournamentAnalytics.player_id == player_id,
            models.TournamentAnalytics.algorithm == "points",
        )
    )
    result = await session.execute(query)
    analytics = result.scalars().first()

    analytics.shift = shift
    session.add(analytics)
    await session.commit()
    return analytics
