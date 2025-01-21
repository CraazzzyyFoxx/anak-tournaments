import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination

from . import flows

router = APIRouter(prefix="/gamemodes", tags=[enums.RouteTag.GAMEMODE])


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.GamemodeRead],
    description="Retrieve a paginated list of all gamemodes. Supports search and filtering.",
    summary="Get all gamemodes",
)
async def get_all(
    request: Request,
    session: AsyncSession = Depends(db.get_async_session),
    params: pagination.PaginationSortSearchQueryParams[
        typing.Literal["id", "name", "slug", "similarity:name", "similarity:slug"]
    ] = Depends(),
):
    return await flows.get_all(
        session, pagination.PaginationSortSearchParams.from_query_params(params)
    )


@router.get(
    path="/{id}",
    response_model=schemas.GamemodeRead,
    description=f"Retrieve details of a specific gamemode by its ID. **Cache TTL:** {config.settings.gamemodes_cache_ttl} minutes.",
    summary="Get gamemode by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.gamemodes_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get(
    request: Request,
    id: int,
    entities: list[str] = Query([]),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get(session, id, entities)
