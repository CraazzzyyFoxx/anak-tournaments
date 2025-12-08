"""
Routes initialization
"""
from fastapi import APIRouter
from src.routes import auth, health, discord, player

router = APIRouter()
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(discord.router)
router.include_router(player.router)

__all__ = ["router"]
