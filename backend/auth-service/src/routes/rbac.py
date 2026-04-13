"""
RBAC (Role-Based Access Control) routes
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from shared.models.oauth import OAuthConnection
from shared.models.rbac import Permission, Role, role_permissions, user_roles
from shared.models.workspace import WorkspaceMember
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models, schemas
from src.core import db
from src.services import auth_service
from src.services.player_link_service import PlayerLinkService
from src.services.session_cache import invalidate_rbac

router = APIRouter(prefix="/rbac", tags=["RBAC"])

ADMIN_EQUIVALENT_ROLE_NAMES = {"admin"}


def _permission_key(resource: str, action: str) -> str:
    if resource == "*" and action == "*":
        return "admin.*"
    return f"{resource}.{action}"


def _effective_permissions(user: models.AuthUser) -> list[str]:
    keys = {
        _permission_key(permission.resource, permission.action)
        for role in user.roles
        for permission in role.permissions
    }
    return sorted(keys)


def _linked_players_payload(user: models.AuthUser) -> list[schemas.AuthUserLinkedPlayerRead]:
    player_links = sorted(
        user.player_links,
        key=lambda link: (
            not link.is_primary,
            link.created_at,
            link.player_id,
        ),
    )
    return [
        schemas.AuthUserLinkedPlayerRead(
            player_id=link.player_id,
            player_name=link.player.name,
            is_primary=link.is_primary,
            linked_at=link.created_at.isoformat(),
        )
        for link in player_links
        if link.player is not None
    ]


async def _count_users_with_role(session: AsyncSession, role_id: int) -> int:
    result = await session.execute(select(user_roles.c.user_id).where(user_roles.c.role_id == role_id))
    return len(result.scalars().all())


async def _invalidate_users_with_role(session: AsyncSession, role_id: int) -> None:
    """Invalidate RBAC cache for every user that holds a given role."""
    result = await session.execute(select(user_roles.c.user_id).where(user_roles.c.role_id == role_id))
    for uid in result.scalars().all():
        await invalidate_rbac(uid)


def _check_workspace_admin(user: models.AuthUser, workspace_id: int) -> None:
    """Raise 403 if user is not admin/owner of the given workspace."""
    if not user.is_workspace_admin(workspace_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Workspace admin or owner role required",
        )


def _check_role_access(user: models.AuthUser, role: Role, required_action: str) -> None:
    """Check access control for a role based on its scope (global vs workspace)."""
    if role.workspace_id is not None:
        _check_workspace_admin(user, role.workspace_id)
    else:
        if not user.has_permission("role", required_action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: role.{required_action} required",
            )


# Permission Routes
@router.get("/permissions", response_model=list[schemas.PermissionRead])
async def list_permissions(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("permission", "read"))],
):
    """List all permissions visible to RBAC operators."""
    result = await session.execute(select(Permission))
    permissions = result.scalars().all()
    return permissions


@router.post("/permissions", response_model=schemas.PermissionRead, status_code=status.HTTP_201_CREATED)
async def create_permission(
    permission_data: schemas.PermissionCreate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)],
):
    """Create a new permission (superuser only)"""
    # Check if permission already exists
    result = await session.execute(select(Permission).where(Permission.name == permission_data.name))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Permission with this name already exists")

    permission = Permission(
        name=permission_data.name,
        resource=permission_data.resource,
        action=permission_data.action,
        description=permission_data.description,
    )
    session.add(permission)
    await session.commit()
    await session.refresh(permission)

    logger.info(f"Permission created: {permission.name}")
    return permission


@router.delete("/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_permission(
    permission_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)],
):
    """Delete a permission (superuser only)"""
    result = await session.execute(select(Permission).where(Permission.id == permission_id))
    permission = result.scalar_one_or_none()

    if not permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")

    rp_result = await session.execute(
        select(role_permissions.c.role_id).where(role_permissions.c.permission_id == permission_id)
    )
    affected_role_ids = rp_result.scalars().all()
    for rid in affected_role_ids:
        await _invalidate_users_with_role(session, rid)

    await session.delete(permission)
    await session.commit()
    logger.info(f"Permission deleted: {permission.name}")


# Role Routes
@router.get("/roles", response_model=list[schemas.RoleRead])
async def list_roles(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
    workspace_id: Annotated[int | None, Query(description="Filter by workspace. Omit for global roles.")] = None,
):
    """List roles, optionally filtered by workspace scope."""
    query = select(Role)

    if workspace_id is not None:
        # Workspace-scoped roles: user must be workspace admin/owner or have global role.read
        if not current_user.is_workspace_admin(workspace_id) and not current_user.has_permission("role", "read"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        query = query.where(Role.workspace_id == workspace_id)
    else:
        # Global roles only: require role.read permission
        if not current_user.has_permission("role", "read"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: role.read required")
        query = query.where(Role.workspace_id.is_(None))

    result = await session.execute(query)
    roles = result.scalars().all()
    return roles


@router.get("/roles/{role_id}", response_model=schemas.RoleWithPermissions)
async def get_role(
    role_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Get role with permissions."""
    result = await session.execute(select(Role).where(Role.id == role_id).options(selectinload(Role.permissions)))
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    # Access control based on scope
    if role.workspace_id is not None:
        if not current_user.is_workspace_admin(role.workspace_id) and not current_user.has_permission("role", "read"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    else:
        if not current_user.has_permission("role", "read"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: role.read required")

    return role


@router.post("/roles", response_model=schemas.RoleRead, status_code=status.HTTP_201_CREATED)
async def create_role(
    role_data: schemas.RoleCreate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Create a new role (global or workspace-scoped)."""
    # Access control
    if role_data.workspace_id is not None:
        _check_workspace_admin(current_user, role_data.workspace_id)
        # Verify workspace exists
        ws_result = await session.execute(
            select(models.Workspace.id).where(models.Workspace.id == role_data.workspace_id)
        )
        if not ws_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    else:
        if not current_user.has_permission("role", "create"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: role.create required",
            )

    # Check uniqueness within scope
    uniqueness_query = select(Role).where(Role.name == role_data.name)
    if role_data.workspace_id is not None:
        uniqueness_query = uniqueness_query.where(Role.workspace_id == role_data.workspace_id)
    else:
        uniqueness_query = uniqueness_query.where(Role.workspace_id.is_(None))

    result = await session.execute(uniqueness_query)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role with this name already exists")

    role = Role(
        name=role_data.name,
        description=role_data.description,
        is_system=False,
        workspace_id=role_data.workspace_id,
    )

    # Add permissions
    if role_data.permission_ids:
        result = await session.execute(select(Permission).where(Permission.id.in_(role_data.permission_ids)))
        permissions = result.scalars().all()
        role.permissions = list(permissions)

    session.add(role)
    await session.commit()
    await session.refresh(role)

    logger.info(f"Role created: {role.name} (workspace_id={role.workspace_id})")
    return role


@router.patch("/roles/{role_id}", response_model=schemas.RoleRead)
async def update_role(
    role_id: int,
    role_data: schemas.RoleUpdate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Update a role."""
    result = await session.execute(select(Role).where(Role.id == role_id).options(selectinload(Role.permissions)))
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify system roles")

    # Access control based on role's scope
    _check_role_access(current_user, role, "update")

    if role_data.name is not None:
        # Check uniqueness within scope
        uniqueness_query = select(Role).where(Role.name == role_data.name, Role.id != role_id)
        if role.workspace_id is not None:
            uniqueness_query = uniqueness_query.where(Role.workspace_id == role.workspace_id)
        else:
            uniqueness_query = uniqueness_query.where(Role.workspace_id.is_(None))

        result = await session.execute(uniqueness_query)
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role with this name already exists")
        role.name = role_data.name

    if role_data.description is not None:
        role.description = role_data.description

    permissions_changed = False
    if role_data.permission_ids is not None:
        result = await session.execute(select(Permission).where(Permission.id.in_(role_data.permission_ids)))
        permissions = result.scalars().all()
        role.permissions = list(permissions)
        permissions_changed = True

    await session.commit()
    await session.refresh(role)

    if permissions_changed:
        await _invalidate_users_with_role(session, role.id)

    logger.info(f"Role updated: {role.name}")
    return role


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Delete a role."""
    result = await session.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete system roles")

    # Access control based on role's scope
    _check_role_access(current_user, role, "delete")

    await _invalidate_users_with_role(session, role.id)
    await session.delete(role)
    await session.commit()
    logger.info(f"Role deleted: {role.name}")


@router.get("/users", response_model=list[schemas.AuthUserListRead])
async def list_auth_users(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "read"))],
    search: str | None = None,
    role_id: int | None = None,
    is_active: bool | None = None,
    is_superuser: bool | None = None,
):
    """List auth users with assigned roles."""

    users = await auth_service.AuthService.list_users_with_rbac(
        session,
        search=search,
        role_id=role_id,
        is_active=is_active,
        is_superuser=is_superuser,
        include_player_links=True,
    )
    return [
        schemas.AuthUserListRead.model_validate(
            {
                **schemas.AuthUserListRead.model_validate(user, from_attributes=True).model_dump(),
                "linked_players": _linked_players_payload(user),
            }
        )
        for user in users
    ]


@router.get("/users/{user_id}", response_model=schemas.AuthUserDetailRead)
async def get_auth_user(
    user_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "read"))],
):
    """Get auth-user detail with assigned roles and effective permissions."""

    user = await auth_service.AuthService.get_user_with_rbac(session, user_id, include_player_links=True)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    payload = schemas.AuthUserListRead.model_validate(user, from_attributes=True).model_dump()
    payload["linked_players"] = _linked_players_payload(user)
    payload["effective_permissions"] = _effective_permissions(user)
    return schemas.AuthUserDetailRead.model_validate(payload)


@router.post("/users/{user_id}/linked-players", status_code=status.HTTP_204_NO_CONTENT)
async def assign_linked_player_to_auth_user(
    user_id: int,
    data: schemas.AuthUserPlayerLinkAssign,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "update"))],
):
    """Assign a player account from the analytics system to an auth user."""

    result = await session.execute(select(models.AuthUser).where(models.AuthUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    await PlayerLinkService.admin_link_player(session, user_id, data.player_id, data.is_primary)


@router.delete("/users/{user_id}/linked-players/{player_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_linked_player_from_auth_user(
    user_id: int,
    player_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "update"))],
):
    """Remove a player account link from an auth user."""

    result = await session.execute(select(models.AuthUser).where(models.AuthUser.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    await PlayerLinkService.admin_unlink_player(session, user_id, player_id)


# User Role Assignment Routes
@router.post("/users/assign-role", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role_to_user(
    data: schemas.UserRoleAssign,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Assign a role to a user."""
    # Check if user exists
    result = await session.execute(select(models.AuthUser).where(models.AuthUser.id == data.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check if role exists
    result = await session.execute(select(Role).where(Role.id == data.role_id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    # Access control based on role's scope
    if role.workspace_id is not None:
        _check_workspace_admin(current_user, role.workspace_id)
        # Target user must be a workspace member
        member_result = await session.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == role.workspace_id,
                WorkspaceMember.auth_user_id == data.user_id,
            )
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Target user must be a member of the workspace",
            )
    else:
        if not current_user.has_permission("role", "assign"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: role.assign required",
            )

    # Check if user already has this role
    if role in user.roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User already has this role")

    user.roles.append(role)
    await session.commit()
    await invalidate_rbac(data.user_id)
    logger.info(f"Role {role.name} assigned to user {user.email}")


@router.post("/users/remove-role", status_code=status.HTTP_204_NO_CONTENT)
async def remove_role_from_user(
    data: schemas.UserRoleRemove,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Remove a role from a user."""
    # Check if user exists
    result = await session.execute(
        select(models.AuthUser).where(models.AuthUser.id == data.user_id).options(selectinload(models.AuthUser.roles))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Check if role exists
    result = await session.execute(select(Role).where(Role.id == data.role_id))
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    # Access control based on role's scope
    if role.workspace_id is not None:
        _check_workspace_admin(current_user, role.workspace_id)
    else:
        if not current_user.has_permission("role", "assign"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied: role.assign required",
            )

    # Check if user has this role
    if role not in user.roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not have this role")

    if role.name in ADMIN_EQUIVALENT_ROLE_NAMES:
        role_assignment_count = await _count_users_with_role(session, role.id)
        if role_assignment_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove the last admin role assignment"
            )

    user.roles.remove(role)
    await session.commit()
    await invalidate_rbac(data.user_id)
    logger.info(f"Role {role.name} removed from user {user.email}")


@router.get("/users/{user_id}/roles", response_model=list[schemas.RoleRead])
async def get_user_roles(
    user_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "read"))],
):
    """Get all roles for a user."""

    result = await session.execute(
        select(models.AuthUser).where(models.AuthUser.id == user_id).options(selectinload(models.AuthUser.roles))
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    return user.roles


@router.get("/oauth-connections", response_model=list[schemas.OAuthConnectionAdminRead])
async def list_oauth_connections(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "read"))],
    search: str | None = None,
    provider: str | None = None,
):
    """List all OAuth connections across all users (admin view)."""

    query = (
        select(OAuthConnection)
        .options(selectinload(OAuthConnection.auth_user))
        .order_by(OAuthConnection.id.desc())
    )

    if provider:
        query = query.where(OAuthConnection.provider == provider)

    if search:
        term = f"%{search}%"
        query = query.where(
            OAuthConnection.username.ilike(term)
            | OAuthConnection.email.ilike(term)
            | OAuthConnection.display_name.ilike(term)
            | OAuthConnection.provider_user_id.ilike(term)
        )

    result = await session.execute(query)
    connections = result.scalars().all()

    return [
        schemas.OAuthConnectionAdminRead(
            id=conn.id,
            provider=conn.provider,
            provider_user_id=conn.provider_user_id,
            email=conn.email,
            username=conn.username,
            display_name=conn.display_name,
            avatar_url=conn.avatar_url,
            created_at=conn.created_at,
            updated_at=conn.updated_at,
            auth_user_id=conn.auth_user_id,
            auth_user_email=conn.auth_user.email if conn.auth_user else None,
            auth_user_username=conn.auth_user.username if conn.auth_user else None,
            token_expires_at=conn.token_expires_at,
        )
        for conn in connections
    ]


@router.delete("/oauth-connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_oauth_connection(
    connection_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "update"))],
):
    """Delete a specific OAuth connection from an auth user (admin view)."""

    result = await session.execute(
        select(OAuthConnection)
        .where(OAuthConnection.id == connection_id)
        .options(selectinload(OAuthConnection.auth_user))
    )
    connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OAuth connection not found")

    linked_user = connection.auth_user
    if linked_user and not linked_user.hashed_password:
        count_result = await session.execute(
            select(OAuthConnection.id).where(OAuthConnection.auth_user_id == connection.auth_user_id)
        )
        connections_count = len(count_result.scalars().all())
        if connections_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot unlink last OAuth provider for a passwordless account. Set a password first.",
            )

    await session.delete(connection)
    await session.commit()
    logger.info(
        "OAuth connection deleted by admin: "
        f"connection_id={connection.id} provider={connection.provider} auth_user_id={connection.auth_user_id} "
        f"actor_user_id={current_user.id}"
    )
