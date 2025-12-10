import typing

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.src import schemas, models
from app.src.core import config, db, enums, pagination, auth

from app.src.services.analytics import flows as analytics_flows

router = APIRouter(prefix="/analytics", tags=[enums.RouteTag.ANALYTICS])


@router.get(
    path="/algorithms/{id}",
    response_model=schemas.AnalyticsAlgorithmRead,
    description="Retrieve details of a specific analytics algorithm by its ID.",
    summary="Get analytics algorithm by ID",
)
async def get_one(
    id: int,
    session=Depends(db.get_async_session),
):
    return await analytics_flows.get_algorithm(session, id)


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
    return await analytics_flows.get_algorithms(
        session, pagination.PaginationParams.from_query_params(params)
    )


@router.get(
    path="",
    response_model=schemas.TournamentAnalytics,
    description=f"Retrieve analytics for tournaments. **Cache TTL: {config.settings.tournaments_cache_ttl / 60} minutes.**",
    summary="Get tournament analytics",
)
async def get_analytics(
    request: Request,
    tournament_id: int,
    algorithm: int,
    start_tournament_id: int | None = None,
    end_tournament_id: int | None = None,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await analytics_flows.get_analytics(session, tournament_id, algorithm)


@router.post(
    path="/shift",
    response_model=schemas.PlayerAnalytics,
    description="Changes shift for a player in a tournament.",
    summary="Change player shift",
)
async def change_shift(
    data: schemas.PlayerShiftUpdate,
    current_user: models.AuthUser = Depends(auth.get_current_superuser),
    session: AsyncSession = Depends(db.get_async_session),
):
    return await analytics_flows.change_shift(session, data.player_id, data.shift)


@router.get(
    path="/streaks",
    response_model=typing.Sequence[schemas.PlayerStreak],
    description="Retrieve player streaks for a tournament.",
    summary="Get player streaks",
)
async def get_streaks(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    return await analytics_flows.get_streaks(session, tournament_id)
