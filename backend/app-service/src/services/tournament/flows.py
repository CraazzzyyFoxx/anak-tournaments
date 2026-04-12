import statistics
import typing
from itertools import groupby

from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DivisionGrid

from src import models, schemas
from src.core import enums, errors, pagination
from src.services.registration import service as registration_service
from src.services.team import service as team_service
from src.services.user import flows as user_flows

from . import service


async def to_pydantic(
    session: AsyncSession, tournament: models.Tournament, entities: list[str]
) -> schemas.TournamentRead:
    """
    Converts a `Tournament` model instance to a Pydantic `TournamentRead` schema, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        tournament: The `Tournament` model instance to convert.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `TournamentRead` schema instance.
    """
    stages: list[schemas.StageRead] = []
    participants_count: int | None = None
    registrations_count: int | None = None
    if "stages" in entities:
        stages = [
            schemas.StageRead.model_validate(stage, from_attributes=True)
            for stage in sorted(tournament.stages, key=lambda item: item.order)
        ]
    if "participants_count" in entities:
        participants_count = await team_service.get_player_count_by_tournament(session, tournament.id)
    if "registrations_count" in entities:
        registrations_count = await registration_service.get_registration_count_by_tournament(session, tournament.id)
    return schemas.TournamentRead(
        id=tournament.id,
        workspace_id=tournament.workspace_id,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        number=tournament.number,
        is_league=tournament.is_league,
        is_finished=tournament.is_finished,
        status=tournament.status,
        name=tournament.name,
        description=tournament.description,
        challonge_id=tournament.challonge_id,
        challonge_slug=tournament.challonge_slug,
        registration_opens_at=tournament.registration_opens_at,
        registration_closes_at=tournament.registration_closes_at,
        check_in_opens_at=tournament.check_in_opens_at,
        check_in_closes_at=tournament.check_in_closes_at,
        win_points=tournament.win_points,
        draw_points=tournament.draw_points,
        loss_points=tournament.loss_points,
        stages=stages,
        participants_count=participants_count,
        registrations_count=registrations_count,
    )


async def to_pydantic_group(
    session: AsyncSession, group: models.TournamentGroup, entities: list[str]
) -> schemas.TournamentGroupRead:
    """
    Converts a `TournamentGroup` model instance to a Pydantic `TournamentGroupRead` schema.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        group: The `TournamentGroup` model instance to convert.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `TournamentGroupRead` schema instance.
    """
    return schemas.TournamentGroupRead(
        id=group.id,
        name=group.name,
        is_groups=group.is_groups,
        challonge_id=group.challonge_id,
        challonge_slug=group.challonge_slug,
        description=group.description,
    )


async def get(session: AsyncSession, id: int, entities: list[str]) -> models.Tournament:
    """
    Retrieves a `Tournament` model instance by its ID, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the tournament to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `Tournament` model instance.

    Raises:
        errors.ApiHTTPException: If the tournament is not found.
    """
    tournament = await service.get(session, id, entities)
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this id not found",
                )
            ],
        )
    return tournament


async def get_read(session: AsyncSession, id: int, entities: list[str]) -> schemas.TournamentRead:
    """
    Retrieves a `Tournament` model instance by its ID and converts it to a `TournamentRead` schema.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        id: The ID of the tournament to retrieve.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `TournamentRead` schema instance.
    """
    tournament = await get(session, id, entities)
    return await to_pydantic(session, tournament, entities)


async def get_by_number_and_league(
    session: AsyncSession, number: int, is_league: bool, entities: list[str]
) -> models.Tournament:
    """
    Retrieves a `Tournament` model instance by its number and league status, optionally including related entities.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        number: The number of the tournament to retrieve.
        is_league: Whether the tournament is a league.
        entities: A list of strings representing the names of related entities to include.

    Returns:
        A `Tournament` model instance.

    Raises:
        errors.ApiHTTPException: If the tournament is not found.
    """
    tournament = await service.get_by_number_and_league(session, number, is_league, entities)
    if tournament is None:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="tournament_not_found",
                    msg="Tournament with this number not found",
                )
            ],
        )
    return tournament


async def get_all(
    session: AsyncSession, params: schemas.TournamentPaginationSortSearchParams
) -> pagination.Paginated[schemas.TournamentRead]:
    """
    Retrieves a paginated list of `Tournament` model instances and converts them to `TournamentRead` schemas.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.
        params: An instance of `SearchPaginationParams` containing pagination and filtering parameters.

    Returns:
        A `Paginated` instance containing `TournamentRead` schemas.
    """
    results, total = await service.get_all(session, params)
    return pagination.Paginated(
        results=[await to_pydantic(session, result, params.entities) for result in results],
        total=total,
        per_page=params.per_page,
        page=params.page,
    )


async def get_history_tournaments(
    session: AsyncSession, workspace_id: int | None = None,
) -> list[schemas.TournamentStatistics]:
    """
    Retrieves historical statistics for tournaments.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A list of `TournamentStatistics` schemas.
    """
    output: list[schemas.TournamentStatistics] = []
    stats = await service.get_history_tournaments(session, workspace_id=workspace_id)
    for stat in stats:
        if stat[2] is None:
            continue
        output.append(
            schemas.TournamentStatistics(
                id=stat[0].id,
                number=stat[0].number,
                players_count=stat[1],
                avg_sr=round(stat[2], 2),
                avg_closeness=stat[3],
            )
        )
    return output


async def get_avg_divisions_tournaments(
    session: AsyncSession, workspace_id: int | None = None, *, grid: DivisionGrid,
) -> list[schemas.DivisionStatistics]:
    """
    Retrieves average division statistics for tournaments.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A list of `DivisionStatistics` schemas.
    """
    cache: dict[int, dict[enums.HeroClass, float]] = {}
    output: list[schemas.DivisionStatistics] = []
    tournaments: dict[int, int] = {}
    stats = await service.get_avg_div_tournaments(session, workspace_id=workspace_id, grid=grid)
    for tournament, role, value in stats:
        if tournament.id not in cache:
            cache[tournament.id] = {}
            tournaments[tournament.id] = tournament.number
        cache[tournament.id][role] = value

    def round_or_none(value: float | None) -> float | None:
        return round(value, 2) if value is not None else None

    for tournament_id, roles in cache.items():
        output.append(
            schemas.DivisionStatistics(
                id=tournament_id,
                number=tournaments[tournament_id],
                tank_avg_div=round_or_none(roles.get(enums.HeroClass.tank)),
                damage_avg_div=round_or_none(roles.get(enums.HeroClass.damage)),
                support_avg_div=round_or_none(roles.get(enums.HeroClass.support)),
            )
        )

    return output


async def get_tournaments_overall(session: AsyncSession, workspace_id: int | None = None) -> schemas.OverallStatistics:
    """
    Retrieves overall statistics for tournaments, including counts of tournaments, teams, players, and champions.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        An `OverallStatistics` schema instance.
    """
    tournaments, teams, players, champions = await service.get_tournaments_overall(session, workspace_id=workspace_id)
    return schemas.OverallStatistics(
        tournaments=tournaments,
        teams=teams,
        players=players,
        champions=champions,
    )


async def get_owal_standings(
    session: AsyncSession, season: typing.Optional[str] = None, workspace_id: int | None = None,
    *, grid: DivisionGrid,
) -> schemas.OwalStandings:
    """
    Retrieves OWAL (Overwatch Anak League) standings.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        An `OwalStandings` schema instance.
    """
    seasons = await service.get_owal_seasons(session, workspace_id=workspace_id)
    if not seasons:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="owal_seasons_not_found",
                    msg="OWAL seasons not found",
                )
            ],
        )

    return await get_owal_standings_by_season(
        session, season or seasons[0], workspace_id=workspace_id, grid=grid,
    )


async def get_owal_standings_by_season(
    session: AsyncSession, season: str, workspace_id: int | None = None, *, grid: DivisionGrid,
) -> schemas.OwalStandings:
    standings_output: list[schemas.OwalStanding] = []
    cache: dict[int, dict[enums.HeroClass, dict[int, schemas.OwalStandingDay]]] = {}
    user_cache: dict[int, models.User] = {}
    user_pydantic_cache: dict[int, schemas.UserRead] = {}

    standings = await service.get_owal_standings(session, season, workspace_id=workspace_id)
    days_tournament = await service.get_owal_days(session, season, workspace_id=workspace_id)
    for user, team, tournament, player in standings:
        cache.setdefault(user.id, {})
        cache[user.id].setdefault(player.role, {})
        user_cache.setdefault(user.id, user)
        standing = team.standings[0]

        cache[user.id][player.role][tournament.id] = schemas.OwalStandingDay(
            team=team.name,
            role=player.role,
            division=grid.resolve_division_number(player.rank),
            points=standing.win + standing.draw * 0.5 + standing.buchholz * 0.01,
            wins=standing.win,
            draws=standing.draw,
            losses=standing.lose,
            win_rate=round(
                (standing.win * 2 + standing.draw) / ((standing.win + standing.draw + standing.lose) * 2),
                2,
            ),
        )

    for user_id, days_dict_roles in cache.items():
        for role, days_dict in days_dict_roles.items():
            user = user_cache[user_id]
            if user_id not in user_pydantic_cache:
                user_pydantic_cache[user_id] = await user_flows.to_pydantic(session, user, [])
            days = days_dict.values()
            avg_win_rate = sum(day.win_rate for day in days) / len(days)
            last_day = days_dict[max(days_dict.keys())]
            standings_output.append(
                schemas.OwalStanding(
                    user=user_pydantic_cache[user_id],
                    role=role,
                    division=last_day.division,
                    days=days_dict,
                    count_days=len(days),
                    place=0,
                    best_3_days=sum(day.points for day in sorted(days, key=lambda x: x.points, reverse=True)[:3]),
                    avg_points=sum(day.points for day in days) / len(days),
                    wins=sum(day.wins for day in days),
                    draws=sum(day.draws for day in days),
                    losses=sum(day.losses for day in days),
                    win_rate=round(avg_win_rate, 2),
                )
            )

    standings_output.sort(key=lambda x: x.best_3_days, reverse=True)
    rank = 1
    for _key, group in groupby(standings_output, key=lambda x: x.best_3_days):
        group_list = list(group)
        for standing in group_list:
            standing.place = rank
        rank += len(group_list)

    return schemas.OwalStandings(
        days=[await to_pydantic(session, day, []) for day in days_tournament],
        standings=standings_output,
    )


async def get_owal_seasons(session: AsyncSession, workspace_id: int | None = None) -> list[str]:
    return await service.get_owal_seasons(session, workspace_id=workspace_id)


async def get_league_player_stacks(
    session: AsyncSession, season: str, workspace_id: int | None = None,
) -> list[schemas.LeaguePlayerStack]:
    stacks, team_tournament_players, standings_dict = await service.get_league_player_stacks(
        session, season, workspace_id=workspace_id,
    )

    user_pydantic_cache: dict[int, schemas.UserRead] = {}

    async def get_user_read(user: models.User) -> schemas.UserRead:
        if user.id not in user_pydantic_cache:
            user_pydantic_cache[user.id] = await user_flows.to_pydantic(session, user, [])
        return user_pydantic_cache[user.id]

    stack_results = []
    for (player1_id, player2_id), team_tournaments in stacks.items():
        positions = []
        for team_id, tournament_id in team_tournaments:
            standing = standings_dict.get((team_id, tournament_id))
            if standing and standing.overall_position:
                positions.append(standing.overall_position)

        if positions and len(team_tournaments) > 1:
            avg_position = statistics.mean(positions)
            games_together = len(team_tournaments)

            player1, player2 = None, None
            for players in team_tournament_players.values():
                for p in players:
                    if p.user_id == player1_id:
                        player1 = p
                    elif p.user_id == player2_id:
                        player2 = p
                    if player1 and player2:
                        break
                if player1 and player2:
                    break

            if player1 is None or player2 is None:
                continue

            player1_value = typing.cast(models.Player, player1)
            player2_value = typing.cast(models.Player, player2)

            stack_results.append(
                schemas.LeaguePlayerStack(
                    user_1=await get_user_read(player1_value.user),
                    user_2=await get_user_read(player2_value.user),
                    games=games_together,
                    avg_position=round(avg_position, 2),
                )
            )

    stack_results.sort(key=lambda x: x.avg_position)

    return stack_results
