"""Authentication dependencies for tournament-service."""

from __future__ import annotations

from typing import Annotated, Any

import sqlalchemy as sa
from fastapi import Depends, HTTPException, WebSocket, status
from shared.core.auth import create_auth_dependencies
from shared.models.auth_user import AuthUser
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import db


async def _resolve_user_from_db(user_id: int, payload: dict[str, Any], *, session: AsyncSession) -> AuthUser | None:
    result = await session.execute(select(AuthUser).where(AuthUser.id == user_id))
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
require_workspace_admin = _auth.require_workspace_admin


async def _require_workspace_permission(
    current_user: AuthUser,
    *,
    workspace_id: int,
    resource: str,
    action: str,
) -> AuthUser:
    if current_user.has_role("tournament_organizer"):
        return current_user

    if current_user.is_workspace_admin(workspace_id):
        return current_user

    if not current_user.has_workspace_permission(workspace_id, resource, action):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission denied for workspace {workspace_id}: {resource}.{action} required",
        )

    return current_user


async def _get_tournament_workspace_id(session: AsyncSession, tournament_id: int) -> int:
    workspace_id = await session.scalar(
        sa.select(models.Tournament.workspace_id).where(models.Tournament.id == tournament_id)
    )
    if workspace_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tournament not found",
        )
    return int(workspace_id)


async def _get_registration_workspace_id(session: AsyncSession, registration_id: int) -> int:
    workspace_id = await session.scalar(
        sa.select(models.BalancerRegistration.workspace_id).where(models.BalancerRegistration.id == registration_id)
    )
    if workspace_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration not found",
        )
    return int(workspace_id)


def require_workspace_permission(resource: str, action: str):
    async def permission_checker(
        workspace_id: int,
        current_user: Annotated[AuthUser, Depends(get_current_active_user)],
    ) -> AuthUser:
        return await _require_workspace_permission(
            current_user,
            workspace_id=workspace_id,
            resource=resource,
            action=action,
        )

    return permission_checker


def require_tournament_permission(resource: str, action: str):
    async def permission_checker(
        tournament_id: int,
        session: Annotated[AsyncSession, Depends(db.get_async_session)],
        current_user: Annotated[AuthUser, Depends(get_current_active_user)],
    ) -> AuthUser:
        workspace_id = await _get_tournament_workspace_id(session, tournament_id)
        return await _require_workspace_permission(
            current_user,
            workspace_id=workspace_id,
            resource=resource,
            action=action,
        )

    return permission_checker


def require_registration_permission(resource: str, action: str):
    async def permission_checker(
        registration_id: int,
        session: Annotated[AsyncSession, Depends(db.get_async_session)],
        current_user: Annotated[AuthUser, Depends(get_current_active_user)],
    ) -> AuthUser:
        workspace_id = await _get_registration_workspace_id(session, registration_id)
        return await _require_workspace_permission(
            current_user,
            workspace_id=workspace_id,
            resource=resource,
            action=action,
        )

    return permission_checker


def _get_websocket_token(websocket: WebSocket) -> str | None:
    query_token = websocket.query_params.get("token")
    if query_token:
        return query_token.removeprefix("Bearer ").strip() or None

    authorization = websocket.headers.get("authorization")
    if authorization:
        scheme, _, credentials = authorization.partition(" ")
        if scheme.lower() == "bearer" and credentials:
            return credentials.strip()

    cookie_token = websocket.cookies.get("aqt_access_token")
    if not cookie_token:
        return None

    return cookie_token.removeprefix("Bearer ").strip() or None


async def get_websocket_user_optional(
    websocket: WebSocket,
    session: AsyncSession,
) -> AuthUser | None:
    token = _get_websocket_token(websocket)
    if not token:
        return None

    import main  # noqa: PLC0415

    payload = await main.auth_client.validate_token(token)
    if not payload:
        return None

    user_id_raw = payload.get("sub")
    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        return None

    if user_id <= 0:
        return None

    return await _resolve_user_from_db(user_id, payload, session=session)
