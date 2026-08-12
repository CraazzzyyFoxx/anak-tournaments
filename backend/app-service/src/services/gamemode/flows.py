from sqlalchemy.ext.asyncio import AsyncSession

from shared.repository import GamemodeRepository
from src import models, schemas
from src.core import errors, pagination

_gamemode_repo = GamemodeRepository()


async def to_pydantic(session: AsyncSession, gamemode: models.Gamemode, entities: list[str]) -> schemas.GamemodeRead:
    """Serialize a Gamemode into ``GamemodeRead``.

    Spreads ``to_dict()`` rather than enumerating fields, matching the map and
    hero serializers. The enumerated version silently dropped every column added
    after it was written: `aliases` fell back to the schema default `[]`, so the
    admin dialog rendered an empty editor over real data and saving it would have
    wiped the aliases the log parser resolves names through.

    ``entities`` is accepted for signature parity with the other catalog
    serializers; a gamemode has no expandable relation in this payload.
    """
    return schemas.GamemodeRead(**gamemode.to_dict())


async def get(session: AsyncSession, gamemode_id: int, entities: list[str]) -> schemas.GamemodeRead:
    """
    Retrieves a gamemode by its ID and converts it to a Pydantic schema.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        gamemode_id (int): The ID of the gamemode to retrieve.
        entities (list[str]): A list of related entities to include (e.g., ["maps"]).

    Returns:
        schemas.GamemodeRead: The Pydantic schema representing the gamemode.

    Raises:
        errors.ApiHTTPException: If the gamemode is not found.
    """
    gamemode = (
        await _gamemode_repo.get_with_maps(session, gamemode_id)
        if "maps" in entities
        else await _gamemode_repo.get(session, gamemode_id)
    )

    if not gamemode:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(
                    code="not_found",
                    msg=f"Gamemode not found with id={gamemode_id}",
                )
            ],
        )

    return await to_pydantic(session, gamemode, entities)


async def get_all(
    session: AsyncSession, params: pagination.PaginationSortSearchParams
) -> pagination.Paginated[schemas.GamemodeRead]:
    """
    Retrieves a paginated list of gamemodes and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.PaginationSortSearchParams): Search, pagination, and sorting parameters.

    Returns:
        pagination.Paginated[schemas.GamemodeRead]: A paginated list of Pydantic schemas representing the gamemodes.
    """
    gamemodes, total = await _gamemode_repo.all(session, params, with_maps="maps" in params.entities)
    return pagination.Paginated(
        total=total,
        per_page=params.per_page,
        page=params.page,
        results=[await to_pydantic(session, gamemode, params.entities) for gamemode in gamemodes],
    )
