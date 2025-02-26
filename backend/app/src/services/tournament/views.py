import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.core import config, db, enums, pagination
from src.services.standings import flows as standings_flows

from . import flows

router = APIRouter(prefix="/tournaments", tags=[enums.RouteTag.TOURNAMENT])


@router.get(
    path="/{id}",
    response_model=schemas.TournamentRead,
    description="Retrieve details of a specific tournament by its ID. "
    "Supports fetching additional related entities. "
    "Available entities: **groups**."
    f"**Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.**",
    summary="Get tournament by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
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
    path="/{id}/standings",
    response_model=list[schemas.StandingRead],
    description="Retrieve standings for a specific tournament by its ID. "
    "Supports fetching additional related entities. "
    "Available entities: **tournament**, **group**, **team**."
    f"**Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.**",
    summary="Get tournament standings by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_standings(
    request: Request,
    id: int,
    entities: list[str] = Query([]),
    session: AsyncSession = Depends(db.get_async_session),
):
    tournament = await flows.get(session, id, [])
    return await standings_flows.get_by_tournament(session, tournament, entities)


@router.get(
    path="",
    response_model=pagination.Paginated[schemas.TournamentRead],
    description="Retrieve a paginated list of tournaments. Supports search and filtering. Available entities: **groups**.",
    summary="Get all tournaments",
)
async def get_all_tournaments(
    params: schemas.TournamentPaginationSortSearchQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_all(
        session, schemas.TournamentPaginationSortSearchParams.from_query_params(params)
    )


@router.get(
    path="/statistics/history",
    response_model=list[schemas.TournamentStatistics],
    description=f"Retrieve historical statistics for tournaments. \n **Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.**",
    summary="Get tournament statistics (players, closeness, team price) history",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_statistics(
    request: Request,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_history_tournaments(session)


@router.get(
    path="/statistics/division",
    response_model=list[schemas.DivisionStatistics],
    description=f"Retrieve division-based statistics for tournaments. **Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.**",
    summary="Get division statistics",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_avg_div(
    request: Request,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_avg_divisions_tournaments(session)


@router.get(
    path="/statistics/overall",
    response_model=schemas.OverallStatistics,
    description=f"Retrieve overall tournament statistics. Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.",
    summary="Get overall tournament statistics",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_most_players(
    request: Request,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_tournaments_overall(session)


@router.get(
    path="/owal/results",
    response_model=schemas.OwalStandings,
    description=f"Retrieve OWAL tournament standings. Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.",
    summary="Get OWAL standings",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_owal_standings(
    request: Request,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_owal_standings(session)


@router.get(
    path="/statistics/analytics",
    response_model=schemas.TournamentAnalytics,
    description=f"Retrieve analytics for tournaments. **Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.**",
    summary="Get tournament analytics",
)
# @cache(
#     ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
#     key="fastapi:{request.url.path}/{request.query_params}",
# )
async def get_analytics(
    request: Request,
    tournament_id: int,
    algorithm: typing.Literal["points", "openskill"] = "points",
    start_tournament_id: int | None = None,
    end_tournament_id: int | None = None,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_analytics(session, tournament_id, algorithm)
