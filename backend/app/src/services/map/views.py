from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination

from . import flows

router = APIRouter(prefix="/maps", tags=[enums.RouteTag.MAP])


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.MapRead],
    description="Retrieve a list of maps with pagination. "
    "Available entities: **gamemode**. ",
    summary="Get all maps",
)
async def get_all(
    params: pagination.SearchQueryParams = Depends(),
    session=Depends(db.get_async_session),
):
    return await flows.get_all(
        session, pagination.SearchPaginationParams.from_query_params(params)
    )


@router.get(
    path="/{id}",
    response_model=schemas.MapRead,
    description="Retrieve a map by its ID. "
    "Available entities: **gamemode**. "
    "**Cache TTL: 24 hours.**",
    summary="Get map by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.maps_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_by_id(
    request: Request,
    id: int,
    session=Depends(db.get_async_session),
    entities: list[str] = Query([]),
):
    return await flows.get(session, id, entities)
