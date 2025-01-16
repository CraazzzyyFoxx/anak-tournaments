import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from src import models
from src.core import pagination, utils


def gamemode_entities(
    in_entities: list[str], child: typing.Any | None = None
) -> list[_AbstractLoad]:
    """
    Generates a list of SQLAlchemy loading options for related entities of a gamemode.

    Parameters:
        in_entities (list[str]): A list of entity names to load (e.g., ["maps"]).
        child (typing.Any | None): Optional child entity for nested loading.

    Returns:
        list[_AbstractLoad]: A list of SQLAlchemy loading options.
    """
    entities = []
    if "maps" in in_entities:
        entities.append(utils.join_entity(child, models.Gamemode.maps))

    return entities


async def get(
    session: AsyncSession, id: int, entities: list[str]
) -> models.Gamemode | None:
    """
    Retrieves a gamemode by its ID.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the gamemode to retrieve.
        entities (list[str]): A list of related entities to load (e.g., ["maps"]).

    Returns:
        models.Gamemode | None: The Gamemode object if found, otherwise None.
    """
    query = (
        sa.select(models.Gamemode)
        .filter_by(id=id)
        .options(*gamemode_entities(entities))
    )
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def get_all(
    session: AsyncSession,
    params: pagination.SearchPaginationParams,
) -> tuple[typing.Sequence[models.Gamemode], int]:
    """
    Retrieves a paginated list of gamemodes based on search parameters.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.SearchPaginationParams): Search, pagination, and sorting parameters.

    Returns:
        tuple[typing.Sequence[models.Gamemode], int]: A tuple containing:
            - A sequence of Gamemode objects.
            - The total count of gamemodes.
    """
    total_query = sa.select(sa.func.count(models.Gamemode.id))
    query = sa.select(models.Gamemode).options(*gamemode_entities(params.entities))

    query = params.apply_pagination_sort(query, models.Gamemode)
    if params.query:
        query = params.apply_search(query, models.Gamemode)
        total_query = params.apply_search(total_query, models.Gamemode)

    result = await session.execute(query)
    total_result = await session.execute(total_query)
    return result.unique().scalars().all(), total_result.scalar_one()
