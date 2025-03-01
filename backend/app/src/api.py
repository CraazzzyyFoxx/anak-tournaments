from fastapi import APIRouter

from src.services.achievements.views import router as achievements_router
from src.services.encounter.views import encounter_router, match_router
from src.services.gamemode.views import router as gamemode_router
from src.services.hero.views import router as hero_router
from src.services.map.views import router as map_router
from src.services.statistics.views import router as statistics_router
from src.services.team.views import router as team_router
from src.services.tournament.views import router as tournament_router
from src.services.user.views import router as user_router
from src.services.utils.views import router as utils_router
from src.services.analytics.views import router as analytics_router

router = APIRouter()
router.include_router(user_router)
router.include_router(tournament_router)
router.include_router(team_router)
router.include_router(encounter_router)
router.include_router(match_router)
router.include_router(statistics_router)
router.include_router(hero_router)
router.include_router(gamemode_router)
router.include_router(map_router)
router.include_router(achievements_router)
router.include_router(utils_router)
router.include_router(analytics_router)
