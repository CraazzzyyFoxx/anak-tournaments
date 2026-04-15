from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from src.core import enums, db, auth

from src.services.analytics import flows as analytics_flows

router = APIRouter(
    prefix="/analytics",
    tags=[enums.RouteTag.ANALYTICS],
)


class AnalyticsRecalculateRequest(BaseModel):
    tournament_id: int
    algorithm_ids: list[int] = Field(default_factory=list)


@router.post(path="/recalculate")
async def recalculate_analytics(
    data: AnalyticsRecalculateRequest,
    _user=Depends(auth.require_permission("analytics", "update")),
    session=Depends(db.get_async_session),
):
    algorithm_names = None
    if data.algorithm_ids:
        algorithms = await analytics_flows.service.get_algorithms(session, data.algorithm_ids)
        algorithm_names = [algorithm.name for algorithm in algorithms]

    recalculated = await analytics_flows.recalculate_analytics(
        session,
        data.tournament_id,
        algorithm_names,
    )
    return {"message": "Analytics recalculated successfully", "algorithms": recalculated}


@router.post(path="/points")
async def create_analytics_tournament_points(
    tournament_id: int,
    _user=Depends(auth.require_permission("analytics", "update")),
    session=Depends(db.get_async_session),
):
    await analytics_flows.recalculate_analytics(session, tournament_id, [analytics_flows.POINTS])
    return {"message": "Points calculated successfully"}


@router.post(path="/openskill")
async def create_analytics_tournament_analytics(
    tournament_id: int,
    _user=Depends(auth.require_permission("analytics", "update")),
    session=Depends(db.get_async_session),
):
    await analytics_flows.recalculate_analytics(session, tournament_id, [analytics_flows.OPEN_SKILL])
    return {"message": "Analytics calculated successfully"}
