from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import errors, pagination

from . import service


async def to_pydantic(
    session: AsyncSession, hero: models.Hero, entities: list[str]
) -> schemas.HeroRead:
    """
    Converts a Hero model instance to a Pydantic schema (HeroRead).

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        hero (models.Hero): The Hero model instance to convert.
        entities (list[str]): A list of related entities to include (currently unused in this function).

    Returns:
        schemas.HeroRead: The Pydantic schema representing the hero.
    """
    return schemas.HeroRead.model_validate(hero, from_attributes=True)


async def get(session: AsyncSession, id: int) -> schemas.HeroRead:
    """
    Retrieves a hero by its ID and converts it to a Pydantic schema.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        id (int): The ID of the hero to retrieve.

    Returns:
        schemas.HeroRead: The Pydantic schema representing the hero.
    """
    hero = await service.get(session, id)
    return await to_pydantic(session, hero, [])


async def get_by_name(session: AsyncSession, name: str) -> models.Hero:
    """
    Retrieves a hero by its name.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        name (str): The name of the hero to retrieve.

    Returns:
        models.Hero: The Hero object if found.

    Raises:
        errors.ApiHTTPException: If the hero is not found.
    """
    hero = await service.get_by_name(session, name)
    if not hero:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg=f"Hero with name {name} not found"),
            ],
        )
    return hero


async def get_all(
    session: AsyncSession, params: pagination.SearchPaginationParams
) -> pagination.Paginated[schemas.HeroRead]:
    """
    Retrieves a paginated list of heroes and converts them to Pydantic schemas.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (pagination.SearchPaginationParams): Search, pagination, and sorting parameters.

    Returns:
        pagination.Paginated[schemas.HeroRead]: A paginated list of Pydantic schemas representing the heroes.
    """
    heroes, total = await service.get_all(session, params)
    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=total,
        results=[await to_pydantic(session, hero, []) for hero in heroes],
    )


async def get_playtime(
    session: AsyncSession, params: schemas.HeroPlaytimePaginationParams
) -> pagination.Paginated[schemas.HeroPlaytime]:
    """
    Retrieves a paginated list of heroes with their playtime statistics.

    Parameters:
        session (AsyncSession): The SQLAlchemy async session.
        params (schemas.HeroPlaytimePaginationParams): Pagination and filtering parameters.

    Returns:
        pagination.Paginated[schemas.HeroPlaytime]: A paginated list of Pydantic schemas representing the heroes with their playtime percentages.
    """
    heroes, total = await service.get_heroes_playtime(session, params)
    return pagination.Paginated(
        page=params.page,
        per_page=params.per_page,
        total=total,
        results=[
            schemas.HeroPlaytime(
                hero=await to_pydantic(session, hero, []),
                playtime=round(playtime * 100, 2),
            )
            for hero, playtime in heroes
        ],
    )
