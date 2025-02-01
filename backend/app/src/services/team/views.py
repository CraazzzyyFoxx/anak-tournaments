import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination

from . import flows

router = APIRouter(prefix="/teams", tags=[enums.RouteTag.TEAMS])


@router.get(
    path="/{id}",
    response_model=schemas.TeamRead,
    description="Retrieve details of a specific team by its ID. "
    "Supports fetching additional related entities. "
    "Available entities: tournament, players, captain, placement, group. "
    f"**Cache TTL: {config.settings.teams_cache_ttl / 60} minutes.**",
    summary="Get team by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.teams_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_one(
    request: Request,
    id: int,
    entities: list[str] = Query([]),
    session=Depends(db.get_async_session),
):
    return await flows.get_read(session, id, entities)


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.TeamRead],
    description="Retrieve a paginated list of teams. "
    "Supports search and filtering. "
    "Available entities: tournament, players, captain, placement, group. ",
    summary="Get all teams",
)
async def get_all(
    params: schemas.TeamFilterQueryParams[
        typing.Literal["id", "name", "total_sr", "avg_sr", "placement", "group"]
    ] = Depends(),
    session=Depends(db.get_async_session),
):
    return await flows.get_all(
        session, schemas.TeamFilterParams.from_query_params(params)
    )
