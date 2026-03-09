"""
RBAC (Role-Based Access Control) routes
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core import db
from loguru import logger
from src import schemas, models
from src.services import auth_service
from shared.models.rbac import Role, Permission

router = APIRouter(prefix="/rbac", tags=["RBAC"])


# Permission Routes
@router.get("/permissions", response_model=list[schemas.PermissionRead])
async def list_permissions(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """List all permissions (superuser only)"""
    result = await session.execute(select(Permission))
    permissions = result.scalars().all()
    return permissions


@router.post("/permissions", response_model=schemas.PermissionRead, status_code=status.HTTP_201_CREATED)
async def create_permission(
    permission_data: schemas.PermissionCreate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Create a new permission (superuser only)"""
    # Check if permission already exists
    result = await session.execute(
        select(Permission).where(Permission.name == permission_data.name)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Permission with this name already exists"
        )

    permission = Permission(
        name=permission_data.name,
        resource=permission_data.resource,
        action=permission_data.action,
        description=permission_data.description
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
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Delete a permission (superuser only)"""
    result = await session.execute(
        select(Permission).where(Permission.id == permission_id)
    )
    permission = result.scalar_one_or_none()
    
    if not permission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found"
        )
    
    await session.delete(permission)
    await session.commit()
    logger.info(f"Permission deleted: {permission.name}")


# Role Routes
@router.get("/roles", response_model=list[schemas.RoleRead])
async def list_roles(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """List all roles"""
    result = await session.execute(select(Role))
    roles = result.scalars().all()
    return roles


@router.get("/roles/{role_id}", response_model=schemas.RoleWithPermissions)
async def get_role(
    role_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """Get role with permissions"""
    result = await session.execute(
        select(Role)
        .where(Role.id == role_id)
        .options(selectinload(Role.permissions))
    )
    role = result.scalar_one_or_none()
    
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )
    
    return role


@router.post("/roles", response_model=schemas.RoleRead, status_code=status.HTTP_201_CREATED)
async def create_role(
    role_data: schemas.RoleCreate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Create a new role (superuser only)"""
    # Check if role already exists
    result = await session.execute(
        select(Role).where(Role.name == role_data.name)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role with this name already exists"
        )

    role = Role(
        name=role_data.name,
        description=role_data.description,
        is_system=False
    )
    
    # Add permissions
    if role_data.permission_ids:
        result = await session.execute(
            select(Permission).where(Permission.id.in_(role_data.permission_ids))
        )
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
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Update a role (superuser only)"""
    result = await session.execute(
        select(Role).where(Role.id == role_id).options(selectinload(Role.permissions))
    )
    role = result.scalar_one_or_none()
    
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )
    
    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify system roles"
        )
    
    if role_data.name is not None:
        # Check if new name is already taken
        result = await session.execute(
            select(Role).where(Role.name == role_data.name, Role.id != role_id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role with this name already exists"
            )
        role.name = role_data.name
    
    if role_data.description is not None:
        role.description = role_data.description
    
    if role_data.permission_ids is not None:
        result = await session.execute(
            select(Permission).where(Permission.id.in_(role_data.permission_ids))
        )
        permissions = result.scalars().all()
        role.permissions = list(permissions)
    
    await session.commit()
    await session.refresh(role)
    
    logger.info(f"Role updated: {role.name}")
    return role


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(
    role_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Delete a role (superuser only)"""
    result = await session.execute(
        select(Role).where(Role.id == role_id)
    )
    role = result.scalar_one_or_none()
    
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )
    
    if role.is_system:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete system roles"
        )
    
    await session.delete(role)
    await session.commit()
    logger.info(f"Role deleted: {role.name}")


# User Role Assignment Routes
@router.post("/users/assign-role", status_code=status.HTTP_204_NO_CONTENT)
async def assign_role_to_user(
    data: schemas.UserRoleAssign,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Assign a role to a user (superuser only)"""
    # Check if user exists
    result = await session.execute(
        select(models.AuthUser).where(models.AuthUser.id == data.user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Check if role exists
    result = await session.execute(
        select(Role).where(Role.id == data.role_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )
    
    # Check if user already has this role
    if role in user.roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User already has this role"
        )
    
    user.roles.append(role)
    await session.commit()
    logger.info(f"Role {role.name} assigned to user {user.email}")


@router.post("/users/remove-role", status_code=status.HTTP_204_NO_CONTENT)
async def remove_role_from_user(
    data: schemas.UserRoleRemove,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_superuser)]
):
    """Remove a role from a user (superuser only)"""
    # Check if user exists
    result = await session.execute(
        select(models.AuthUser)
        .where(models.AuthUser.id == data.user_id)
        .options(selectinload(models.AuthUser.roles))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Check if role exists
    result = await session.execute(
        select(Role).where(Role.id == data.role_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found"
        )
    
    # Check if user has this role
    if role not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User does not have this role"
        )
    
    user.roles.remove(role)
    await session.commit()
    logger.info(f"Role {role.name} removed from user {user.email}")


@router.get("/users/{user_id}/roles", response_model=list[schemas.RoleRead])
async def get_user_roles(
    user_id: int,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """Get all roles for a user"""
    # Users can only see their own roles unless they're superuser
    if user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    
    result = await session.execute(
        select(models.AuthUser)
        .where(models.AuthUser.id == user_id)
        .options(selectinload(models.AuthUser.roles))
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return user.roles
