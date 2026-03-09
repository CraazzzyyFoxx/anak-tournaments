"""
Health check routes
"""
from datetime import datetime, UTC

from fastapi import APIRouter
from shared.schemas import HealthCheckResponse

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check() -> HealthCheckResponse:
    """Health check endpoint"""
    return HealthCheckResponse(
        status="ok",
        service="auth-service",
        version="1.0.0",
        timestamp=int(datetime.now(UTC).timestamp()),
    )

