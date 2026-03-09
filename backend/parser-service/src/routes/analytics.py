from fastapi import APIRouter, Depends

from src.core import enums, db, auth

from src.services.analytics import flows as analytics_flows

router = APIRouter(
    prefix="/analytics",
    tags=[enums.RouteTag.ANALYTICS],
    dependencies=[Depends(auth.require_role("admin"))],
)


@router.post(path="/points")
async def create_analytics_tournament_points(
    tournament_id: int,
    session=Depends(db.get_async_session),
):
    await analytics_flows.get_analytics(session, tournament_id)
    return {"message": "Points calculated successfully"}


@router.post(path="/openskill")
async def create_analytics_tournament_analytics(
    tournament_id: int,
    session=Depends(db.get_async_session),
):
    await analytics_flows.get_analytics_openskill(session, tournament_id)
    await analytics_flows.get_predictions_openskill(session, tournament_id)
    return {"message": "Analytics calculated successfully"}
