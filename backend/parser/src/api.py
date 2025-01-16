from fastapi import APIRouter

from src.services.tournament.views import router as tournament_router
from src.services.team.views import router as team_router
from src.services.encounter.views import router as encounter_router
from src.services.standings.views import router as standings_router
from src.services.hero.views import router as hero_router
from src.services.user.views import router as user_router
from src.services.logs_parser.views import router as logs_parser_router
from src.services.challonge.views import router as challonge_router
from src.services.auth.views import router as auth_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(tournament_router)
router.include_router(team_router)
router.include_router(encounter_router)
router.include_router(standings_router)
router.include_router(hero_router)
router.include_router(user_router)
router.include_router(logs_parser_router)
router.include_router(challonge_router)
