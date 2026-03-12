"""
RBAC (Role-Based Access Control) routes
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from shared.models.rbac import Permission, Role, role_permissions, user_roles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models, schemas
from src.core import db
from src.services import auth_service
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


async def _count_users_with_role(session: AsyncSession, role_id: int) -> int:
    result = await session.execute(select(user_roles.c.user_id).where(user_roles.c.role_id == role_id))
    return len(result.scalars().all())


async def _invalidate_users_with_role(session: AsyncSession, role_id: int) -> None:
    """Invalidate RBAC cache for every user that holds a given role."""
    result = await session.execute(select(user_roles.c.user_id).where(user_roles.c.role_id == role_id))
    for uid in result.scalars().all():
        await invalidate_rbac(uid)


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
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "read"))],
):
    """List all roles visible to RBAC operators."""
    result = await session.execute(select(Role))
    roles = result.scalars().all()
    return roles


@router.get("/roles/{role_id}", response_model=schemas.RoleWithPermissions)
async def get_role(
    role_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "read"))],
):
    """Get role with permissions."""
    result = await session.execute(select(Role).where(Role.id == role_id).options(selectinload(Role.permissions)))
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    return role


@router.post("/roles", response_model=schemas.RoleRead, status_code=status.HTTP_201_CREATED)
async def create_role(
    role_data: schemas.RoleCreate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "create"))],
):
    """Create a new role."""
    # Check if role already exists
    result = await session.execute(select(Role).where(Role.name == role_data.name))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role with this name already exists")

    role = Role(name=role_data.name, description=role_data.description, is_system=False)

    # Add permissions
    if role_data.permission_ids:
        result = await session.execute(select(Permission).where(Permission.id.in_(role_data.permission_ids)))
        permissions = result.scalars().all()
        role.permissions = list(permissions)

    session.add(role)
    await session.commit()
    await session.refresh(role)

    logger.info(f"Role created: {role.name}")
    return role


@router.patch("/roles/{role_id}", response_model=schemas.RoleRead)
async def update_role(
    role_id: int,
    role_data: schemas.RoleUpdate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "update"))],
):
    """Update a role."""
    result = await session.execute(select(Role).where(Role.id == role_id).options(selectinload(Role.permissions)))
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify system roles")

    if role_data.name is not None:
        # Check if new name is already taken
        result = await session.execute(select(Role).where(Role.name == role_data.name, Role.id != role_id))
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
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "delete"))],
):
    """Delete a role."""
    result = await session.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()

    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    if role.is_system:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete system roles")

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
    )
    return [schemas.AuthUserListRead.model_validate(user, from_attributes=True) for user in users]


@router.get("/users/{user_id}", response_model=schemas.AuthUserDetailRead)
async def get_auth_user(
    user_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("auth_user", "read"))],
):
    """Get auth-user detail with assigned roles and effective permissions."""

    user = await auth_service.AuthService.get_user_with_rbac(session, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    payload = schemas.AuthUserListRead.model_validate(user, from_attributes=True).model_dump()
    payload["effective_permissions"] = _effective_permissions(user)
    return schemas.AuthUserDetailRead.model_validate(payload)


# User Role Assignment Routes
@router.post("/users/assign-role", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role_to_user(
    data: schemas.UserRoleAssign,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "assign"))],
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
    current_user: Annotated[models.AuthUser, Depends(auth_service.require_permission("role", "assign"))],
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
