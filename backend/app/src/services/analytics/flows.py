import math

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination
from src.services.team import flows as team_flows

from . import service


async def to_pydantic(
    session: AsyncSession, algorithm: models.AnalyticsAlgorithm
) -> schemas.AnalyticsAlgorithmRead:
    return schemas.AnalyticsAlgorithmRead(**algorithm.to_dict())


async def get_algorithms(
    session: AsyncSession, params: pagination.PaginationParams
) -> pagination.Paginated[schemas.AnalyticsAlgorithmRead]:
    """
    Retrieves all available analytics algorithms.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.

    Returns:
        list[models.AnalyticsAlgorithm]: A list of all available analytics algorithms.
    """
    algorithms = await service.get_algorithms(session)
    return pagination.Paginated(
        total=len(algorithms),
        results=[await to_pydantic(session, algorithm) for algorithm in algorithms],
        page=params.page,
        per_page=params.per_page,
    )


async def get_algorithm(
    session: AsyncSession, id: int
) -> schemas.AnalyticsAlgorithmRead:
    """
    Retrieves a specific analytics algorithm.

    Parameters:
        id (int): The ID of the algorithm.
        session (AsyncSession): The SQLAlchemy async session.

    Returns:
        models.AnalyticsAlgorithm: The analytics algorithm.
    """
    algorithm = await service.get_algorithm(session, id)
    if not algorithm:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg="Analytics algorithm not found.")
            ],
        )
    return await to_pydantic(session, algorithm)


async def get_analytics(
    session: AsyncSession, tournament_id: int, algorithm_id: int
) -> schemas.TournamentAnalytics:
    """
    Retrieves analytics data for a specific tournament.

    Parameters:
        algorithm_id (int): The ID of the algorithm.
        session (AsyncSession): The SQLAlchemy async session.
        tournament_id (int): The ID of the tournament.

    Returns:
        schemas.TeamAnalytics: The analytics data for the tournament.
    """
    algorithm = await service.get_algorithm(session, algorithm_id)

    output: list[schemas.TeamAnalytics] = []
    cache_teams: dict[int, models.Team] = {}
    cache_players: dict[
        int, list[tuple[models.Player, models.AnalyticsPlayer, models.AnalyticsShift]]
    ] = {}
    cache_teams_wins: dict[int, int] = {}
    cache_teams_manual_shift: dict[int, int] = {}

    data = await service.get_analytics(session, tournament_id, algorithm)
    for team, player, shift, analytics in data:
        cache_teams[team.id] = team
        cache_players.setdefault(team.id, [])
        cache_teams_manual_shift.setdefault(team.id, 0)
        cache_teams_manual_shift[team.id] += (
            analytics.shift_one if analytics.shift_one else 0
        )
        cache_players[team.id].append((player, analytics, shift))
        if team.id not in cache_teams_wins:
            cache_teams_wins[team.id] = analytics.wins

    avg_team_cost = round(
        sum([t.avg_sr for t in cache_teams.values()]) / max(len(cache_teams), 1)
    )

    for team_id, team in cache_teams.items():
        players = cache_players[team_id]
        team_read = await team_flows.to_pydantic(session, team, ["placement", "group"])
        balancer_shift = -math.ceil(
            ((team.avg_sr - (team.avg_sr % 10)) - avg_team_cost) / 20
        )
        manual_shift = round(cache_teams_manual_shift[team_id] / 100)

        output.append(
            schemas.TeamAnalytics(
                **team_read.model_dump(exclude={"players"}),
                balancer_shift=balancer_shift,
                manual_shift=manual_shift,
                total_shift=balancer_shift + manual_shift,
                players=[
                    schemas.PlayerAnalytics(
                        **(
                            await team_flows.to_pydantic_player(session, player, [])
                        ).model_dump(),
                        move_1=analytics.shift_one,
                        move_2=analytics.shift_two,
                        points=shift.shift,
                        shift=analytics.shift,
                    )
                    for player, analytics, shift in players
                ],
            )
        )

    return schemas.TournamentAnalytics(
        teams=sorted(output, key=lambda x: (x.placement, x.name)),
        teams_wins=cache_teams_wins,
    )


async def change_shift(
    session: AsyncSession, team_id: int, player_id: int, shift: int
) -> schemas.PlayerAnalytics:
    analytics, calculated_shift = await service.change_shift(
        session, team_id, player_id, shift
    )
    player = await team_flows.get_player(session, player_id, [])
    return schemas.PlayerAnalytics(
        **(await team_flows.to_pydantic_player(session, player, [])).model_dump(),
        move_1=analytics.shift_one,
        move_2=analytics.shift_two,
        points=calculated_shift.shift,
        shift=analytics.shift,
    )
