from fastapi import APIRouter

from src.core import enums

router = APIRouter(prefix="/hero", tags=[enums.RouteTag.HERO])
