"""Authentication dependencies for parser-service (DB-backed + service scopes)."""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.auth import create_auth_dependencies
from shared.models.auth_user import AuthUser

from src.core import db

# Re-use the shared security scheme
_security = HTTPBearer(auto_error=False)


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


# ── Shared auth dependencies (DB-backed) ─────────────────────────────

async def _resolve_user_from_db(
    user_id: int, payload: dict[str, Any], *, session: AsyncSession
) -> AuthUser | None:
    result = await session.execute(
        select(AuthUser).where(AuthUser.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is not None:
        workspace_rbac: dict[int, dict] = {}
        for ws in payload.get("workspaces", []):
            ws_id = ws.get("workspace_id")
            if ws_id is not None:
                workspace_rbac[ws_id] = {
                    "roles": ws.get("rbac_roles", []),
                    "permissions": ws.get("rbac_permissions", []),
                }
        user.set_rbac_cache(
            role_names=payload.get("roles", []),
            permissions=payload.get("permissions", []),
            workspaces=payload.get("workspaces", []),
            workspace_rbac=workspace_rbac,
        )
    return user


_auth = create_auth_dependencies(
    _resolve_user_from_db,
    get_session=db.get_async_session,
)

get_current_user = _auth.get_current_user
get_current_active_user = _auth.get_current_active_user
get_current_superuser = _auth.get_current_superuser
require_permission = _auth.require_permission
require_role = _auth.require_role
require_any_role = _auth.require_any_role
require_workspace_member = _auth.require_workspace_member


# ── Parser-specific: service token scopes ─────────────────────────────

def require_service_scope(scope: str) -> Callable:
    """Dependency factory for requiring a service token scope."""

    async def scope_checker(
        request: Request,
        token: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
    ) -> dict:
        token_value = _get_request_token(token, request)
        if not token_value:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate service credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        import main
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
        token: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
        session: Annotated[AsyncSession, Depends(db.get_async_session)],
    ):
        token_value = _get_request_token(token, request)
        if not token_value:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        import main
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
    token: Annotated[HTTPAuthorizationCredentials | None, Depends(_security)],
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
) -> AuthUser | None:
    """Return the authenticated user if a valid user token is provided, otherwise None."""
    try:
        return await get_current_user(request=request, token=token, session=session)
    except HTTPException:
        return None
