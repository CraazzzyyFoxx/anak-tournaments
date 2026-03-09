"""
Authentication service for JWT-based authentication
Uses auth-service microservice for token validation with RBAC support
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import db

# Allow falling back to cookies (SSE/EventSource can't set Authorization header).
security = HTTPBearer(auto_error=False)


def _safe_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


async def get_current_user(
    request: Request,
    token: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    access_token: Annotated[str | None, Cookie(alias="aqt_access_token")] = None,
) -> models.AuthUser:
    """Get current authenticated user from JWT token via auth-service"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        raw_token = token.credentials if token else access_token
        if not raw_token:
            raise credentials_exception

        # Validate token via auth-service using the shared client
        auth_client = getattr(request.app.state, "auth_client", None)
        if auth_client is None:
            logger.error("auth_client is not configured on app.state")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Authentication service is not available",
            )

        payload = await auth_client.validate_token(raw_token)

        if not payload:
            raise credentials_exception

        user_id_raw = payload.get("sub")
        try:
            user_id = int(user_id_raw)
        except (TypeError, ValueError) as exc:
            raise credentials_exception from exc

        if user_id <= 0:
            raise credentials_exception

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating token: {e}")
        raise credentials_exception from e

    # Fetch user from local database
    result = await session.execute(select(models.AuthUser).where(models.AuthUser.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    return user


async def get_current_active_user(
    current_user: Annotated[models.AuthUser, Depends(get_current_user)],
) -> models.AuthUser:
    """Get current active user"""
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


async def get_current_superuser(
    current_user: Annotated[models.AuthUser, Depends(get_current_active_user)],
) -> models.AuthUser:
    """Get current superuser"""
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user


def require_permission(resource: str, action: str) -> Callable:
    """
    Dependency factory for requiring specific permissions

    Usage:
        @router.get("/tournaments")
        async def list_tournaments(
            user: Annotated[models.AuthUser, Depends(require_permission("tournament", "read"))]
        ):
            ...
    """

    async def permission_checker(
        current_user: Annotated[models.AuthUser, Depends(get_current_active_user)],
    ) -> models.AuthUser:
        if not current_user.has_permission(resource, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=f"Permission denied: {resource}.{action} required"
            )
        return current_user

    return permission_checker


def require_role(role_name: str) -> Callable:
    """
    Dependency factory for requiring specific roles

    Usage:
        @router.get("/admin/users")
        async def list_users(
            user: Annotated[models.AuthUser, Depends(require_role("admin"))]
        ):
            ...
    """

    async def role_checker(
        current_user: Annotated[models.AuthUser, Depends(get_current_active_user)],
    ) -> models.AuthUser:
        if not current_user.has_role(role_name):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Role required: {role_name}")
        return current_user

    return role_checker


def require_any_role(*role_names: str) -> Callable:
    """
    Dependency factory for requiring any of the specified roles

    Usage:
        @router.get("/tournaments/manage")
        async def manage_tournament(
            user: Annotated[models.AuthUser, Depends(require_any_role("admin", "tournament_organizer"))]
        ):
            ...
    """

    async def role_checker(
        current_user: Annotated[models.AuthUser, Depends(get_current_active_user)],
    ) -> models.AuthUser:
        if not any(current_user.has_role(role) for role in role_names):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=f"One of these roles required: {', '.join(role_names)}"
            )
        return current_user

    return role_checker
