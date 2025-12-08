"""
Discord OAuth routes
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.core import db
from src.core.logging import logger
from src import schemas, models
from src.services import auth_service
from src.services.discord_service import DiscordOAuthService

router = APIRouter(prefix="/auth/discord", tags=["Discord OAuth"])


@router.get("/url", response_model=schemas.DiscordOAuthURL)
async def get_discord_oauth_url():
    """
    Get Discord OAuth URL for user to authorize
    """
    url, state = DiscordOAuthService.generate_oauth_url()
    return schemas.DiscordOAuthURL(url=url, state=state)


@router.post("/callback", response_model=schemas.Token)
async def discord_oauth_callback(
    callback_data: schemas.DiscordCallbackRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """
    Handle Discord OAuth callback
    Exchange code for tokens and create/login user
    """
    logger.info(f"Discord OAuth callback with state: {callback_data.state}")
    
    # Exchange code for access token
    token_data = await DiscordOAuthService.exchange_code(callback_data.code)
    
    # Get Discord user info
    discord_user = await DiscordOAuthService.get_user_info(token_data["access_token"])
    
    logger.info(f"Discord user authenticated: {discord_user['username']}#{discord_user.get('discriminator', '0')}")
    
    # Find or create user
    auth_user = await DiscordOAuthService.find_or_create_discord_user(
        session, discord_user, token_data
    )
    
    if not auth_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    # Create JWT tokens
    access_token = auth_service.AuthService.create_access_token(
        data={
            "sub": str(auth_user.id),
            "email": auth_user.email,
            "username": auth_user.username,
            "is_superuser": auth_user.is_superuser,
        }
    )
    
    refresh_token = auth_service.AuthService.create_refresh_token()
    await auth_service.AuthService.create_refresh_token_db(session, auth_user.id, refresh_token, request)
    
    logger.success(f"User logged in via Discord: {auth_user.username}")
    
    return schemas.Token(
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/link", status_code=status.HTTP_200_OK)
async def link_discord_account(
    callback_data: schemas.DiscordCallbackRequest,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Link Discord account to existing authenticated user
    """
    logger.info(f"Linking Discord account for user: {current_user.username}")
    
    # Exchange code for access token
    token_data = await DiscordOAuthService.exchange_code(callback_data.code)
    
    # Get Discord user info
    discord_user = await DiscordOAuthService.get_user_info(token_data["access_token"])
    
    # Link Discord to current user
    await DiscordOAuthService.link_discord_to_existing_user(
        session, current_user, discord_user, token_data
    )
    
    return {"message": "Discord account linked successfully", "discord_username": discord_user["username"]}


@router.delete("/unlink", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_discord_account(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Unlink Discord account from current user
    """
    logger.info(f"Unlinking Discord account for user: {current_user.username}")
    await DiscordOAuthService.unlink_discord(session, current_user)


@router.get("/info", response_model=schemas.DiscordUserInfo | None)
async def get_discord_info(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Get Discord account info for current user
    """
    result = await session.execute(
        select(models.AuthUserDiscord).where(
            models.AuthUserDiscord.auth_user_id == current_user.id
        )
    )
    discord_link = result.scalar_one_or_none()
    
    if not discord_link:
        return None
    
    return schemas.DiscordUserInfo(
        id=discord_link.discord_id,
        username=discord_link.discord_username,
        discriminator=discord_link.discord_discriminator,
        avatar=discord_link.discord_avatar,
        email=discord_link.discord_email
    )
