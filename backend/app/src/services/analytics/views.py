import typing

from cashews import cache
from cashews.contrib.fastapi import cache_control_ttl
from fastapi import APIRouter, Depends, Query, Body, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import schemas
from src.schemas.clerk import ClerkUser
from src.core import config, db, enums, pagination, clerk

from . import flows

router = APIRouter(prefix="/analytics", tags=[enums.RouteTag.TOURNAMENT])


@router.get(
    path="/algorithms/{id}",
    response_model=schemas.AnalyticsAlgorithmRead,
    description="Retrieve details of a specific analytics algorithm by its ID.",
    summary="Get analytics algorithm by ID",
)
@cache(
    ttl=cache_control_ttl(default=config.settings.tournaments_cache_ttl),
    key="fastapi:{request.url.path}/{request.query_params}",
)
async def get_one(
    request: Request,
    id: int,
    session=Depends(db.get_async_session),
):
    return await flows.get_algorithm(session, id)


@router.get(
    path="/algorithms",
    response_model=pagination.Paginated[schemas.AnalyticsAlgorithmRead],
    description="Retrieve a paginated list of algorithms.",
    summary="Get all algorithms",
)
async def get_all_tournaments(
    params: pagination.PaginationQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_algorithms(
        session, pagination.PaginationParams.from_query_params(params)
    )


@router.get(
    path="",
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
    algorithm: int,
    start_tournament_id: int | None = None,
    end_tournament_id: int | None = None,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await flows.get_analytics(session, tournament_id, algorithm)


@router.post(
    path="/shift",
    response_model=schemas.PlayerAnalytics,
    description="Changes shift for a player in a tournament.",
    summary="Change player shift",
)
async def change_shift(
    request: Request,
    team_id: int = Body(...),
    player_id: int = Body(...),
    shift: int = Body(...),
    user: ClerkUser = Depends(clerk.get_current_user),
    session: AsyncSession = Depends(db.get_async_session),
):
    if "org:admin" != user.role:
        raise HTTPException(status_code=403, detail="Not enough permissions")

    return await flows.change_shift(session, team_id, player_id, shift)
