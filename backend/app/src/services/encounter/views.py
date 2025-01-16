from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination

from . import flows

encounter_router = APIRouter(prefix="/encounters", tags=[enums.RouteTag.ENCOUNTER])
match_router = APIRouter(prefix="/matches", tags=[enums.RouteTag.MATCH])


@encounter_router.get(
    path="",
    response_model=pagination.Paginated[schemas.EncounterRead],
    description="Retrieve a paginated list of encounters. Supports search and filtering. Available entities: teams, matches, tournament_group, tournament. ",
    summary="Get all encounters",
)
async def get_all_encounters(
    session: AsyncSession = Depends(db.get_async_session),
    params: schemas.EncounterSearchQueryParams = Depends(),
):
    return await flows.get_all_encounters(
        session, schemas.EncounterSearchParams.from_query_params(params)
    )


@encounter_router.get(
    path="/{id}",
    response_model=schemas.EncounterRead,
    description="Retrieve details of a specific encounter by its ID. "
    "Supports fetching additional related entities. "
    f"**Cache TTL: {config.settings.encounters_cache_ttl / 60} minutes.**",
    summary="Get encounter by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.encounters_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_one(
    request: Request,
    id: int,
    session: AsyncSession = Depends(db.get_async_session),
    entities: list[str] = Query([]),
):
    return await flows.get_encounter(session, id, entities)


@match_router.get(
    path="",
    response_model=pagination.Paginated[schemas.MatchRead],
    description="Retrieve a paginated list of matches. Supports search and filtering. Available entities: teams, encounter, map. ",
    summary="Get all matches",
)
async def get_all_matches(
    session: AsyncSession = Depends(db.get_async_session),
    params: schemas.MatchSearchQueryParams = Depends(),
):
    return await flows.get_all_matches(
        session, schemas.MatchSearchParams.from_query_params(params)
    )


@match_router.get(
    path="/{id}",
    response_model=schemas.MatchReadWithStats,
    description="Retrieve details of a specific match by its ID, including associated statistics. "
    f"**Cache TTL: {config.settings.encounters_cache_ttl / 60} minutes.**",
    summary="Get match by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.encounters_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_match(
    request: Request,
    id: int,
    session: AsyncSession = Depends(db.get_async_session),
    entities: list[str] = Query([]),
):
    return await flows.get_match(session, id, entities)
