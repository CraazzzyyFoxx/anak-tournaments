from fastapi import APIRouter, Depends

from src import schemas
from src.core import auth, db, enums
from src.services.achievement import flows as achievement_flows

router = APIRouter(
    prefix="/achievement",
    tags=[enums.RouteTag.ACHIEVEMENT],
    dependencies=[Depends(auth.require_role("admin"))],
)


@router.post(path="/calculate", response_model=schemas.AchievementCalculateResponse)
async def calculate_achievements(
    payload: schemas.AchievementCalculateRequest | None = None,
    session=Depends(db.get_async_session),
):
    payload = payload or schemas.AchievementCalculateRequest()
    executed = await achievement_flows.calculate_registered_achievements(
        session,
        tournament_id=None,
        slugs=payload.slugs,
        ensure_created=payload.ensure_created,
    )
    return schemas.AchievementCalculateResponse(
        tournament_id=None,
        executed=executed,
        message="Achievement calculation finished",
    )


@router.post(path="/calculate/{tournament_id}", response_model=schemas.AchievementCalculateResponse)
async def calculate_achievements_for_tournament(
    tournament_id: int,
    payload: schemas.AchievementCalculateRequest | None = None,
    session=Depends(db.get_async_session),
):
    payload = payload or schemas.AchievementCalculateRequest()
    executed = await achievement_flows.calculate_registered_achievements(
        session,
        tournament_id=tournament_id,
        slugs=payload.slugs,
        ensure_created=payload.ensure_created,
    )
    return schemas.AchievementCalculateResponse(
        tournament_id=tournament_id,
        executed=executed,
        message="Achievement calculation finished",
    )
