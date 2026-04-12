from fastapi import APIRouter

from .tournament import router as tournament_router
from .stage import router as stage_router
from .team import router as team_router, player_router
from .encounter import router as encounter_router
from .standing import router as standing_router
from .user import router as user_router
from .hero import router as hero_router
from .gamemode import router as gamemode_router
from .map import router as map_router
from .balancer import router as balancer_router
from .registration import router as registration_router
from .discord_channel import router as discord_channel_router
from .logs import router as logs_router
from .achievement_rule import override_router as achievement_override_router
from .achievement_rule import router as achievement_rule_router

# Admin router - aggregates all admin CRUD endpoints
# All endpoints require admin or tournament_organizer role

admin_router = APIRouter(prefix="/admin", tags=["admin"])

admin_router.include_router(tournament_router)
admin_router.include_router(stage_router)
admin_router.include_router(team_router)
admin_router.include_router(player_router)
admin_router.include_router(encounter_router)
admin_router.include_router(standing_router)
admin_router.include_router(user_router)
admin_router.include_router(hero_router)
admin_router.include_router(gamemode_router)
admin_router.include_router(map_router)
admin_router.include_router(balancer_router)
admin_router.include_router(registration_router)
admin_router.include_router(discord_channel_router)
admin_router.include_router(logs_router)
admin_router.include_router(achievement_rule_router)
admin_router.include_router(achievement_override_router)

# TODO: Include remaining routers (hero, gamemode, map, achievement)
# from .encounter import router as encounter_router
# from .standing import router as standing_router
# from .user import router as user_router
# from .hero import router as hero_router
# from .gamemode import router as gamemode_router
# from .map import router as map_router
# from .achievement import router as achievement_router

# admin_router.include_router(team_router)
# admin_router.include_router(player_router)
# admin_router.include_router(encounter_router)
# admin_router.include_router(standing_router)
# admin_router.include_router(user_router)
# admin_router.include_router(hero_router)
# admin_router.include_router(gamemode_router)
# admin_router.include_router(map_router)
# admin_router.include_router(achievement_router)
