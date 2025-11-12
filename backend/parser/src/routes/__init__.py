from fastapi import APIRouter

from src.routes.auth import router as auth_router
from src.routes.challonge import router as challonge_router
from src.routes.encounter import router as encounter_router
from src.routes.match_logs import router as logs_router
from src.routes.match_logs import task_router as logs_task_router
from src.routes.standing import router as standings_router
from src.routes.team import router as team_router
from src.routes.tournament import router as tournament_router
from src.routes.analytics import router as analytics_router
from src.routes.user import router as user_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(tournament_router)
router.include_router(team_router)
router.include_router(encounter_router)
router.include_router(standings_router)
router.include_router(logs_router)
router.include_router(logs_task_router)
router.include_router(challonge_router)
router.include_router(analytics_router)
router.include_router(user_router)

