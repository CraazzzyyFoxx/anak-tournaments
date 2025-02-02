from itertools import groupby

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import enums, errors, pagination
from src.services.team import service as team_service
from src.services.user import flows as user_flows
from src.services.team import flows as team_flows

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
    groups: list[schemas.TournamentGroupRead] = []
    participants_count: int | None = None
    if "groups" in entities:
        groups = [
            schemas.TournamentGroupRead.model_validate(group, from_attributes=True)
            for group in tournament.groups
        ]
    if "participants_count" in entities:
        participants_count = await team_service.get_player_count_by_tournament(
            session, tournament.id
        )
    return schemas.TournamentRead(
        id=tournament.id,
        start_date=tournament.start_date,
        end_date=tournament.end_date,
        number=tournament.number,
        is_league=tournament.is_league,
        is_finished=tournament.is_finished,
        name=tournament.name,
        description=tournament.description,
        challonge_id=tournament.challonge_id,
        challonge_slug=tournament.challonge_slug,
        groups=groups,
        participants_count=participants_count,
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


async def get_read(
    session: AsyncSession, id: int, entities: list[str]
) -> schemas.TournamentRead:
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
    tournament = await service.get_by_number_and_league(
        session, number, is_league, entities
    )
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
    session: AsyncSession, params: pagination.PaginationSortSearchParams
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
        results=[
            await to_pydantic(session, result, params.entities) for result in results
        ],
        total=total,
        per_page=params.per_page,
        page=params.page,
    )


async def get_history_tournaments(
    session: AsyncSession,
) -> list[schemas.TournamentStatistics]:
    """
    Retrieves historical statistics for tournaments.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        A list of `TournamentStatistics` schemas.
    """
    output: list[schemas.TournamentStatistics] = []
    stats = await service.get_history_tournaments(session)
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
    session: AsyncSession,
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
    stats = await service.get_avg_div_tournaments(session)
    for tournament, role, value in stats:
        if tournament.id not in cache:
            cache[tournament.id] = {}
            tournaments[tournament.id] = tournament.number
        cache[tournament.id][role] = value

    for tournament_id, roles in cache.items():
        output.append(
            schemas.DivisionStatistics(
                id=tournament_id,
                number=tournaments[tournament_id],
                tank_avg_div=round(roles.get(enums.HeroClass.tank, 0), 2),
                damage_avg_div=round(roles.get(enums.HeroClass.damage, 0), 2),
                support_avg_div=round(roles.get(enums.HeroClass.support, 0), 2),
            )
        )

    return output


async def get_tournaments_overall(session: AsyncSession) -> schemas.OverallStatistics:
    """
    Retrieves overall statistics for tournaments, including counts of tournaments, teams, players, and champions.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        An `OverallStatistics` schema instance.
    """
    tournaments, teams, players, champions = await service.get_tournaments_overall(
        session
    )
    return schemas.OverallStatistics(
        tournaments=tournaments,
        teams=teams,
        players=players,
        champions=champions,
    )


async def get_owal_standings(session: AsyncSession) -> schemas.OwalStandings:
    """
    Retrieves OWAL (Overwatch Anak League) standings.

    Args:
        session: An SQLAlchemy `AsyncSession` for database interaction.

    Returns:
        An `OwalStandings` schema instance.
    """
    standings_output: list[schemas.OwalStanding] = []
    cache: dict[int, dict[enums.HeroClass, dict[int, schemas.OwalStandingDay]]] = {}
    user_cache: dict[int, models.User] = {}

    standings = await service.get_owal_standings(session)
    days_tournament = await service.get_owal_days(session)
    for user, team, tournament, player in standings:
        cache.setdefault(user.id, {})
        cache[user.id].setdefault(player.role, {})
        user_cache.setdefault(user.id, user)
        standing = team.standings[0]

        cache[user.id][player.role][tournament.id] = schemas.OwalStandingDay(
            team=team.name,
            role=player.role,
            points=standing.win + standing.draw * 0.5 + standing.buchholz * 0.01,
            wins=standing.win,
            draws=standing.draw,
            losses=standing.lose,
            win_rate=round(
                (standing.win * 2 + standing.draw)
                / ((standing.win + standing.draw + standing.lose) * 2),
                2,
            ),
        )

    for user_id, days_dict_roles in cache.items():
        for role, days_dict in days_dict_roles.items():
            user = user_cache[user_id]
            days = days_dict.values()
            avg_win_rate = sum(day.win_rate for day in days) / len(days)
            standings_output.append(
                schemas.OwalStanding(
                    user=await user_flows.to_pydantic(session, user, []),
                    role=role,
                    days=days_dict,
                    count_days=len(days),
                    place=0,
                    best_3_days=sum(
                        day.points
                        for day in sorted(days, key=lambda x: x.points, reverse=True)[
                            :3
                        ]
                    ),
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


def resolve_team_shift(value: float) -> int:
    if value >= 119:
        return 6
    if value >= 99:
        return 5
    if value >= 79:
        return 4
    if value >= 59:
        return 3
    if value >= 39:
        return 2
    if value >= 19:
        return 1

    if value <= -20:
        return 0

    if value <= -39:
        return -1
    if value <= -39:
        return -2
    if value <= -59:
        return -3
    if value <= -79:
        return -4
    if value <= -99:
        return -5
    if value <= -119:
        return -6

    return 0


async def get_analytics(
        session: AsyncSession, tournament_id: int,
) -> schemas.TournamentAnalytics:
    """
    Retrieves analytics data for a specific tournament.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament_id (int): The ID of the tournament.

    Returns:
        schemas.TeamAnalytics: The analytics data for the tournament.
    """
    output: list[schemas.TeamAnalytics] = []
    cache_teams: dict[int, models.Team] = {}
    cache_players: dict[int, list[tuple[models.Player, models.TournamentAnalytics]]] = {}
    cache_teams_wins: dict[int, int] = {}
    cache_teams_manual_shift: dict[int, int] = {}
    min_team_cost: int = 0
    max_team_cost: int = 0
    avg_team_cost: int = 0

    data = await service.get_analytics(session, tournament_id)
    for team, player, analytics in data:
        cache_teams[team.id] = team
        cache_players.setdefault(team.id, [])
        cache_teams_manual_shift.setdefault(team.id, 0)
        cache_teams_manual_shift[team.id] += analytics.shift_one if analytics.shift_one else 0
        cache_players[team.id].append((player, analytics))
        if team.id not in cache_teams_wins:
            cache_teams_wins[team.id] = analytics.wins

        min_team_cost = min(min_team_cost, team.total_sr / 100)
        max_team_cost = max(max_team_cost, team.total_sr/ 100)
        avg_team_cost += team.total_sr


    for team_id, team in cache_teams.items():
        players = cache_players[team_id]
        team_read = await team_flows.to_pydantic(session, team, ["placement", "group"])
        balancer_shift = resolve_team_shift(team.total_sr - avg_team_cost)
        manual_shift = round(cache_teams_manual_shift[team_id] / 100)

        print(f"Team: {team.name} - {balancer_shift} - {cache_teams_manual_shift[team_id]}")

        output.append(
            schemas.TeamAnalytics(
                **team_read.model_dump(exclude={"players"}),
                balancer_shift=balancer_shift,
                manual_shift=manual_shift,
                total_shift=balancer_shift + manual_shift,
                players=[
                    schemas.PlayerAnalytics(
                        **(await team_flows.to_pydantic_player(session, player, [])).model_dump(),
                        move_1=analytics.shift_one,
                        move_2=analytics.shift_two,
                        points=analytics.calculated_shift
                    ) for player, analytics in players
                ]
            )
        )

    return schemas.TournamentAnalytics(
        teams=sorted(output, key=lambda x: x.placement),
        teams_wins=cache_teams_wins
    )
