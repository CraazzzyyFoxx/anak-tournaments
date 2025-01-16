from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination, utils
from src.services.tournament import flows as tournament_flows
from src.services.user import flows as user_flows

from . import service


async def to_pydantic(
    session: AsyncSession, team: models.Team, entities: list[str]
) -> schemas.TeamRead:
    """
    Converts a Team model instance to a Pydantic schema (TeamRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        team (models.Team): The Team model instance to convert.
        entities (list[str]): A list of related entities to include (e.g., ["tournament", "players", "captain"]).

    Returns:
        schemas.TeamRead: The Pydantic schema representing the team.
    """
    tournament: schemas.TournamentRead | None = None
    players_read: list[schemas.PlayerRead] = []
    captain: schemas.UserRead | None = None
    placement: int | None = None
    group: schemas.TournamentGroupRead | None = None

    if "tournament" in entities:
        tournament = await tournament_flows.to_pydantic(
            session, team.tournament, entities=[]
        )
    if "players" in entities:
        players_entities = utils.prepare_entities(entities, "players")
        players_read = [
            await to_player_pydantic(session, player, players_entities)
            for player in team.players
        ]
    if "captain" in entities:
        captain = await user_flows.to_pydantic(
            session, team.captain, utils.prepare_entities(entities, "captain")
        )
    if "placement" in entities:
        if team.standings:
            placement = team.standings[0].overall_position
    if "group" in entities:
        groups = [
            standing.group for standing in team.standings if standing.group.is_groups
        ]
        if groups:
            group = await tournament_flows.to_pydantic_group(session, groups[0], [])

    return schemas.TeamRead(
        id=team.id,
        name=team.name,
        avg_sr=team.avg_sr,
        total_sr=team.total_sr,
        captain_id=team.captain_id,
        tournament_id=team.tournament_id,
        tournament=tournament,
        players=players_read,
        captain=captain,
        placement=placement,
        group=group,
    )


async def to_player_pydantic(
    session: AsyncSession, player: models.Player, entities: list[str]
) -> schemas.PlayerRead:
    """
    Converts a Player model instance to a Pydantic schema (PlayerRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        player (models.Player): The Player model instance to convert.
        entities (list[str]): A list of related entities to include (e.g., ["user", "tournament", "team"]).

    Returns:
        schemas.PlayerRead: The Pydantic schema representing the player.
    """
    user: schemas.UserRead | None = None
    tournament: schemas.TournamentRead | None = None
    team: schemas.TeamRead | None = None

    if "user" in entities:
        user_entities = [
            e.replace("user.", "") for e in entities if e.startswith("user.")
        ]
        user = await user_flows.to_pydantic(session, player.user, user_entities)
    if "tournament" in entities:
        tournament = await tournament_flows.to_pydantic(
            session, player.tournament, entities=[]
        )
    if "team" in entities:
        team = await to_pydantic(session, player.team, entities=[])

    return schemas.PlayerRead(
        **player.to_dict(),
        division=player.div,
        user=user,
        tournament=tournament,
        team=team,
    )


async def get(session: AsyncSession, id: int, entities: list[str]) -> models.Team:
    """
    Retrieves a team by its ID.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the team to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "players"]).

    Returns:
        models.Team: The Team object if found.

    Raises:
        errors.ApiHTTPException: If the team is not found.
    """
    team = await service.get(session, id, entities)
    if not team:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg="Team with id {id} not found.")
            ],
        )
    return team


async def get_read(
    session: AsyncSession, id: int, entities: list[str]
) -> schemas.TeamRead:
    """
    Retrieves a team by its ID and converts it to a Pydantic schema.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the team to retrieve.
        entities (list[str]): A list of related entities to include (e.g., ["tournament", "players"]).

    Returns:
        schemas.TeamRead: The Pydantic schema representing the team.
    """
    team = await get(session, id, entities)
    return await to_pydantic(session, team, entities)


async def get_by_tournament_read(
    session: AsyncSession, tournament_id: int, entities: list[str]
) -> list[schemas.TeamRead]:
    """
    Retrieves all teams for a specific tournament and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament_id (int): The ID of the tournament.
        entities (list[str]): A list of related entities to include (e.g., ["tournament", "players"]).

    Returns:
        list[schemas.TeamRead]: A list of Pydantic schemas representing the teams.
    """
    tournament = await tournament_flows.get(session, tournament_id, [])
    teams = await service.get_by_tournament(
        session, tournament=tournament, entities=entities
    )
    return [await to_pydantic(session, team, entities=entities) for team in teams]


async def get_by_name_and_tournament(
    session: AsyncSession, tournament_id: int, name: str, entities: list[str]
) -> models.Team:
    """
    Retrieves a team by its name and associated tournament.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament_id (int): The ID of the tournament.
        name (str): The name of the team to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "players"]).

    Returns:
        models.Team: The Team object if found.

    Raises:
        errors.ApiHTTPException: If the team is not found.
    """
    team = await service.get_by_name_and_tournament(
        session, tournament_id, name, entities
    )
    if not team:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Team with name {name} in tournament {tournament_id} not found.",
                )
            ],
        )
    return team


async def get_by_tournament_challonge_id(
    session: AsyncSession, tournament_id: int, challonge_id: int, entities: list[str]
) -> models.Team:
    """
    Retrieves a team by its Challonge ID and associated tournament.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        tournament_id (int): The ID of the tournament.
        challonge_id (int): The Challonge ID of the team to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["tournament", "players"]).

    Returns:
        models.Team: The Team object if found.

    Raises:
        errors.ApiHTTPException: If the team is not found.
    """
    team = await service.get_by_tournament_challonge_id(
        session, tournament_id, challonge_id, entities
    )
    if not team:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Team with challonge_id {challonge_id} in tournament {tournament_id} not found.",
                )
            ],
        )
    return team


async def get_player_by_user_and_tournament(
    session: AsyncSession, user_id: int, tournament_id: int, entities: list[str]
) -> models.Player:
    """
    Retrieves a player by their user ID and associated tournament.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        user_id (int): The ID of the user.
        tournament_id (int): The ID of the tournament.
        entities (list[str]): A list of related entities to load (e.g., ["user", "team"]).

    Returns:
        models.Player: The Player object if found.

    Raises:
        errors.ApiHTTPException: If the player is not found.
    """
    player = await service.get_player_by_user_and_tournament(
        session, user_id, tournament_id, entities
    )
    if not player:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Player with user [id={user_id}] not found in tournament [number={tournament_id}].",
                )
            ],
        )

    return player


async def get_all(
    session: AsyncSession, params: schemas.TeamFilterParams
) -> pagination.Paginated[schemas.TeamRead]:
    """
    Retrieves a paginated list of teams based on filter parameters.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.TeamFilterParams): Filter, pagination, and sorting parameters.

    Returns:
        pagination.Paginated[schemas.TeamRead]: A paginated list of Pydantic schemas representing the teams.
    """
    if params.tournament_id:
        await tournament_flows.get(session, params.tournament_id, [])

    results, total = await service.get_all(session, params)
    return pagination.Paginated(
        results=[
            await to_pydantic(session, result, entities=params.entities)
            for result in results
        ],
        total=total,
        per_page=params.per_page,
        page=params.page,
    )
