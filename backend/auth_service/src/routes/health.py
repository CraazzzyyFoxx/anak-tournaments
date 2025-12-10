"""
Health check routes
"""
from fastapi import APIRouter

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "auth-service"}


@router.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Authentication Service API", "version": "1.0.0"}
