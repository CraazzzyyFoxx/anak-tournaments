from fastapi import APIRouter

from src.core import enums

router = APIRouter(prefix="/utils", tags=[enums.RouteTag.UTILITY])


@router.get("/health-check")
async def health_check() -> bool:
    return True
