import typing

from fastapi import APIRouter, Depends, Query
from starlette.requests import Request

from src import schemas
from src.core import db, enums, pagination

from src.services.map import flows as map_flows

router = APIRouter(prefix="/maps", tags=[enums.RouteTag.MAP])


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.MapRead],
    description="Retrieve a list of maps with pagination. "
    "Available entities: **gamemode**. ",
    summary="Get all maps",
)
async def get_all(
    params: pagination.PaginationSortSearchQueryParams[
        typing.Literal["id", "gamemode_id", "name", "similarity:name"]
    ] = Depends(),
    session=Depends(db.get_async_session),
):
    return await map_flows.get_all(
        session, pagination.PaginationSortSearchParams.from_query_params(params)
    )


@router.get(
    path="/{id}",
    response_model=schemas.MapRead,
    description="Retrieve a map by its ID. "
    "Available entities: **gamemode**. "
    "**Cache TTL: 24 hours.**",
    summary="Get map by ID",
)
async def get_by_id(
    request: Request,
    id: int,
    session=Depends(db.get_async_session),
    entities: list[str] = Query([]),
):
    return await map_flows.get(session, id, entities)
