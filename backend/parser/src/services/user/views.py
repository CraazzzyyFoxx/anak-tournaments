from fastapi import APIRouter

from src.core import enums

router = APIRouter(prefix="/users", tags=[enums.RouteTag.USER])
