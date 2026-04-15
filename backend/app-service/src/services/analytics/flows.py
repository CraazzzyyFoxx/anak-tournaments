import math

from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination
from src.core.workspace import get_division_grid
from src.services.team import flows as team_flows
from src.services.user import flows as user_flows

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

    grid = await get_division_grid(session, None, tournament_id=tournament_id)

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
                            await team_flows.to_pydantic_player(session, player, [], grid=grid)
                        ).model_dump(),
                        move_1=analytics.shift_one,
                        move_2=analytics.shift_two,
                        points=shift.shift,
                        shift=analytics.shift,
                        confidence=shift.confidence,
                        effective_evidence=shift.effective_evidence,
                        sample_tournaments=shift.sample_tournaments,
                        sample_matches=shift.sample_matches,
                        log_coverage=shift.log_coverage,
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
    session: AsyncSession, player_id: int, shift: int
) -> schemas.PlayerAnalytics:
    analytics, calculated_shift = await service.change_shift(session, player_id, shift)
    player = await team_flows.get_player(session, player_id, [])
    grid = await get_division_grid(session, None, tournament_id=player.tournament_id)
    return schemas.PlayerAnalytics(
        **(await team_flows.to_pydantic_player(session, player, [], grid=grid)).model_dump(),
        move_1=analytics.shift_one,
        move_2=analytics.shift_two,
        points=calculated_shift.shift,
        shift=analytics.shift,
        confidence=calculated_shift.confidence,
        effective_evidence=calculated_shift.effective_evidence,
        sample_tournaments=calculated_shift.sample_tournaments,
        sample_matches=calculated_shift.sample_matches,
        log_coverage=calculated_shift.log_coverage,
    )


async def get_streaks(
    session: AsyncSession, tournament_id: int
) -> list[schemas.PlayerStreak]:
    cache_pos: dict[str, list[int]] = {}
    cache_users: dict[str, schemas.UserRead] = {}
    output: list[schemas.PlayerStreak] = []
    streaks = await service.get_streaks(session, tournament_id)

    for user, role, place in streaks:
        cache_users.setdefault(
            f"{user.id}-{role}", await user_flows.to_pydantic(session, user, [])
        )
        cache_pos.setdefault(f"{user.id}-{role}", [])
        if len(cache_pos[f"{user.id}-{role}"]) < 3:
            if user.name == "Ocelot#21795":
                print(f"User: {user.name}, Role: {role}, Place: {place}")
            cache_pos[f"{user.id}-{role}"].append(place)

    for key, positions in cache_pos.items():
        if len(positions) < 2:
            continue
        user_id, role = key.split("-")
        user = cache_users[key]
        current_position = positions[0]
        previous_position = positions[1] if len(positions) > 1 else None
        pre_previous_position = positions[2] if len(positions) > 2 else None
        sum_position = sum([p for p in positions if p is not None])

        output.append(
            schemas.PlayerStreak(
                user=user,
                role=role,
                sum_position=sum_position,
                current_position=current_position,
                previous_position=previous_position,
                pre_previous_position=pre_previous_position,
            )
        )

    return sorted(output, key=lambda x: (x.sum_position, x.user.name))
