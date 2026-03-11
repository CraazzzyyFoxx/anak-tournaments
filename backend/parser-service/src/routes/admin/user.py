"""Admin routes for user and identity CRUD operations"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import auth, db, pagination
from src.schemas.admin import user as admin_schemas
from src.services.admin import user as admin_service

router = APIRouter(
    prefix="/users",
    tags=["admin", "users"],
)


# ─── User CRUD ───────────────────────────────────────────────────────────────


@router.get("", response_model=pagination.Paginated[schemas.UserRead])
async def get_users(
    params: admin_schemas.UserListQueryParams = Depends(),
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "read")),
):
    """Get paginated list of users (admin only)"""
    users_list = await admin_service.get_users(
        session,
        admin_schemas.UserListParams.from_query_params(params),
    )
    return users_list


@router.post("", response_model=schemas.UserRead)
async def create_user(
    data: admin_schemas.UserCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "create")),
):
    """Create a new user (admin only)"""
    created_user = await admin_service.create_user(session, data)
    return schemas.UserRead.model_validate(created_user, from_attributes=True)


@router.patch("/{user_id}", response_model=schemas.UserRead)
async def update_user(
    user_id: int,
    data: admin_schemas.UserUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    auth_user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Update user fields (admin only)"""
    updated_user = await admin_service.update_user(session, user_id, data)
    return schemas.UserRead.model_validate(updated_user, from_attributes=True)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "delete")),
):
    """Delete user and all identities (admin only)"""
    await admin_service.delete_user(session, user_id)


# ─── Discord Identity Management ─────────────────────────────────────────────


@router.post("/{user_id}/discord", response_model=schemas.UserDiscordRead)
async def add_discord_identity(
    user_id: int,
    data: admin_schemas.DiscordIdentityCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Add Discord identity to user (admin only)"""
    identity = await admin_service.add_discord_identity(session, user_id, data)
    return schemas.UserDiscordRead.model_validate(identity, from_attributes=True)


@router.patch("/{user_id}/discord/{identity_id}", response_model=schemas.UserDiscordRead)
async def update_discord_identity(
    user_id: int,
    identity_id: int,
    data: admin_schemas.DiscordIdentityUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Update Discord identity (admin only)"""
    identity = await admin_service.update_discord_identity(session, user_id, identity_id, data)
    return schemas.UserDiscordRead.model_validate(identity, from_attributes=True)


@router.delete("/{user_id}/discord/{identity_id}", status_code=204)
async def delete_discord_identity(
    user_id: int,
    identity_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "delete")),
):
    """Delete Discord identity (admin only)"""
    await admin_service.delete_discord_identity(session, user_id, identity_id)


# ─── BattleTag Identity Management ───────────────────────────────────────────


@router.post("/{user_id}/battle-tag", response_model=schemas.UserBattleTagRead)
async def add_battletag_identity(
    user_id: int,
    data: admin_schemas.BattleTagIdentityCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Add BattleTag identity to user (admin only)"""
    identity = await admin_service.add_battletag_identity(session, user_id, data)
    return schemas.UserBattleTagRead.model_validate(identity, from_attributes=True)


@router.patch("/{user_id}/battle-tag/{identity_id}", response_model=schemas.UserBattleTagRead)
async def update_battletag_identity(
    user_id: int,
    identity_id: int,
    data: admin_schemas.BattleTagIdentityUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Update BattleTag identity (admin only)"""
    identity = await admin_service.update_battletag_identity(session, user_id, identity_id, data)
    return schemas.UserBattleTagRead.model_validate(identity, from_attributes=True)


@router.delete("/{user_id}/battle-tag/{identity_id}", status_code=204)
async def delete_battletag_identity(
    user_id: int,
    identity_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "delete")),
):
    """Delete BattleTag identity (admin only)"""
    await admin_service.delete_battletag_identity(session, user_id, identity_id)


# ─── Twitch Identity Management ──────────────────────────────────────────────


@router.post("/{user_id}/twitch", response_model=schemas.UserTwitchRead)
async def add_twitch_identity(
    user_id: int,
    data: admin_schemas.TwitchIdentityCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Add Twitch identity to user (admin only)"""
    identity = await admin_service.add_twitch_identity(session, user_id, data)
    return schemas.UserTwitchRead.model_validate(identity, from_attributes=True)


@router.patch("/{user_id}/twitch/{identity_id}", response_model=schemas.UserTwitchRead)
async def update_twitch_identity(
    user_id: int,
    identity_id: int,
    data: admin_schemas.TwitchIdentityUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "update")),
):
    """Update Twitch identity (admin only)"""
    identity = await admin_service.update_twitch_identity(session, user_id, identity_id, data)
    return schemas.UserTwitchRead.model_validate(identity, from_attributes=True)


@router.delete("/{user_id}/twitch/{identity_id}", status_code=204)
async def delete_twitch_identity(
    user_id: int,
    identity_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("user", "delete")),
):
    """Delete Twitch identity (admin only)"""
    await admin_service.delete_twitch_identity(session, user_id, identity_id)
