from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination
from src.services.user import flows as user_flows

from . import service


async def to_pydantic(
    session: AsyncSession, map: models.Map, entities: list[str]
) -> schemas.MapRead:
    """
    Converts a Map model instance to a Pydantic schema (MapRead), including related entities.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        map (models.Map): The Map model instance to convert.
        entities (list[str]): A list of related entities to include (e.g., ["gamemode"]).

    Returns:
        schemas.MapRead: The Pydantic schema representing the map.
    """
    gamemode: schemas.GamemodeRead | None = None
    if "gamemode" in entities:
        gamemode = schemas.GamemodeRead(**map.gamemode.to_dict())
    return schemas.MapRead(
        **map.to_dict(),
        gamemode=gamemode,
    )


async def get(session: AsyncSession, id: int, entities: list[str]) -> schemas.MapRead:
    """
    Retrieves a map by its ID and converts it to a Pydantic schema.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the map to retrieve.
        entities (list[str]): A list of related entities to include (e.g., ["gamemode"]).

    Returns:
        schemas.MapRead: The Pydantic schema representing the map.

    Raises:
        errors.ApiHTTPException: If the map is not found.
    """
    game_map = await service.get(session, id, entities)
    if not game_map:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg=f"Map with ID {id} not found"),
            ],
        )
    return await to_pydantic(session, game_map, entities)


async def get_by_name(
    session: AsyncSession, name: str, entities: list[str]
) -> schemas.MapRead:
    """
    Retrieves a map by its name and converts it to a Pydantic schema.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        name (str): The name of the map to retrieve.
        entities (list[str]): A list of related entities to include (e.g., ["gamemode"]).

    Returns:
        schemas.MapRead: The Pydantic schema representing the map.

    Raises:
        errors.ApiHTTPException: If the map is not found.
    """
    game_map = await service.get_by_name(session, name, entities)
    if not game_map:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg=f"Map with name {name} not found"),
            ],
        )
    return await to_pydantic(session, game_map, entities)


async def get_all(
    session: AsyncSession, params: pagination.PaginationParams
) -> pagination.Paginated[schemas.MapRead]:
    """
    Retrieves a paginated list of maps and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.PaginationParams): Pagination and sorting parameters.

    Returns:
        pagination.Paginated[schemas.MapRead]: A paginated list of Pydantic schemas representing the maps.
    """
    game_maps, total = await service.get_all(session, params)
    return pagination.Paginated(
        total=total,
        page=params.page,
        per_page=params.per_page,
        results=[
            await to_pydantic(session, game_map, params.entities)
            for game_map in game_maps
        ],
    )


async def get_top_user(
    session: AsyncSession, id: int, params: pagination.PaginationParams
) -> pagination.Paginated[schemas.UserMap]:
    """
    Retrieves a paginated list of top maps for a specific user, including statistics.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the user.
        params (pagination.PaginationParams): Pagination and sorting parameters.

    Returns:
        pagination.Paginated[schemas.UserMap]: A paginated list of Pydantic schemas representing the user's top maps with statistics.
    """
    user = await user_flows.get(session, id, [])
    maps, total = await service.get_top_maps(session, user.id, params)
    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=total,
        results=[
            schemas.UserMap(
                map=await to_pydantic(session, map_, params.entities),
                count=count,
                win=win,
                loss=loss,
                draw=draw,
                win_rate=win_rate,
            )
            for map_, count, win, loss, draw, win_rate in maps
        ],
    )
