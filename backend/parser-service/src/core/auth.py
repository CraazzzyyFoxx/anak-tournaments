"""
Authentication service for JWT-based authentication
Uses auth-service microservice for token validation with RBAC support
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Import from main module to use the singleton instance
import main
from src import models
from src.core import db

security = HTTPBearer(auto_error=False)


def _get_request_token(
    token: HTTPAuthorizationCredentials | None,
    request: Request,
) -> str | None:
    if token is not None:
        return token.credentials

    cookie_token = request.cookies.get("aqt_access_token")
    if not cookie_token:
        return None

    cookie_token = cookie_token.removeprefix("Bearer ").strip()
    return cookie_token or None


async def get_current_user(
    request: Request,
    token: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
) -> models.AuthUser:
    """Get current authenticated user from JWT token via auth-service"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        token_value = _get_request_token(token, request)
        if not token_value:
            raise credentials_exception

        # Validate token via auth-service using the shared client
        payload = await main.auth_client.validate_token(token_value)

        if not payload:
            raise credentials_exception

        try:
            user_id = int(payload.get("sub"))
        except (TypeError, ValueError) as exc:
            raise credentials_exception from exc

        if not user_id:
            raise credentials_exception
    except HTTPException:
        # Re-raise HTTP exceptions (like service unavailable)
        raise
    except Exception as e:
        logger.error(f"Error validating token: {e}")
        raise credentials_exception from e

    result = await session.execute(
        select(models.AuthUser).where(models.AuthUser.id == user_id)
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    user.set_rbac_cache(
        role_names=payload.get("roles", []),
        permissions=payload.get("permissions", []),
    )

    return user


def require_service_scope(scope: str) -> Callable:
    """Dependency factory for requiring a service token scope."""

    async def scope_checker(
        request: Request,
        token: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    ) -> dict:
        token_value = _get_request_token(token, request)
        if not token_value:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate service credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        payload = await main.auth_client.validate_service_token(token_value)
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate service credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        scopes = payload.get("scopes", [])
        if not isinstance(scopes, list) or scope not in scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Service scope required: {scope}",
            )

        return payload

    return scope_checker


def require_role_or_service_scope(role_name: str, scope: str) -> Callable:
    """Allow either an authenticated user with role OR a service token with scope."""

    async def checker(
        request: Request,
        token: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
        session: Annotated[AsyncSession, Depends(db.get_async_session)],
    ):
        token_value = _get_request_token(token, request)
        if not token_value:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        service_payload = await main.auth_client.validate_service_token(token_value)
        if service_payload:
            scopes = service_payload.get("scopes", [])
            if not isinstance(scopes, list) or scope not in scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Service scope required: {scope}",
                )
            return

        user = await get_current_user(request=request, token=token, session=session)
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Inactive user",
            )
        if not user.has_role(role_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role required: {role_name}",
            )

    return checker


async def get_current_user_optional(
    request: Request,
    token: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
) -> models.AuthUser | None:
    """Return the authenticated user if a valid user token is provided, otherwise None."""
    try:
        return await get_current_user(request=request, token=token, session=session)
    except HTTPException:
        return None


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
