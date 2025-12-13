"""
Routes initialization
"""
from fastapi import APIRouter
from src.routes import auth, health, player, rbac, oauth

router = APIRouter()
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(oauth.router)
router.include_router(player.router)
router.include_router(rbac.router)

__all__ = ["router"]
