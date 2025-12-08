"""
Discord OAuth service
"""
import secrets
import httpx
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.logging import logger
from src import models, schemas


class DiscordOAuthService:
    """Service for Discord OAuth operations"""

    @staticmethod
    def generate_oauth_url(state: str | None = None) -> tuple[str, str]:
        """
        Generate Discord OAuth URL with state parameter
        Returns (url, state)
        """
        if not state:
            state = secrets.token_urlsafe(32)
        
        params = {
            "client_id": settings.DISCORD_CLIENT_ID,
            "redirect_uri": settings.DISCORD_REDIRECT_URI,
            "response_type": "code",
            "scope": "identify email",
            "state": state,
        }
        
        param_str = "&".join(f"{k}={v}" for k, v in params.items())
        url = f"{settings.DISCORD_OAUTH_URL}?{param_str}"
        
        return url, state

    @staticmethod
    async def exchange_code(code: str) -> dict[str, Any]:
        """
        Exchange authorization code for access token
        """
        data = {
            "client_id": settings.DISCORD_CLIENT_ID,
            "client_secret": settings.DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.DISCORD_REDIRECT_URI,
        }
        
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    settings.DISCORD_TOKEN_URL,
                    data=data,
                    headers=headers,
                    timeout=10.0
                )
                
                if response.status_code != 200:
                    logger.error(f"Discord token exchange failed: {response.text}")
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to exchange Discord code"
                    )
                
                return response.json()
        except httpx.TimeoutException:
            logger.error("Discord API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Discord service unavailable"
            )
        except Exception as e:
            logger.error(f"Discord token exchange error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Discord authentication failed"
            )

    @staticmethod
    async def get_user_info(access_token: str) -> dict[str, Any]:
        """
        Get Discord user information using access token
        """
        headers = {"Authorization": f"Bearer {access_token}"}
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{settings.DISCORD_API_URL}/users/@me",
                    headers=headers,
                    timeout=10.0
                )
                
                if response.status_code != 200:
                    logger.error(f"Discord user info failed: {response.text}")
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to get Discord user info"
                    )
                
                return response.json()
        except httpx.TimeoutException:
            logger.error("Discord API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Discord service unavailable"
            )
        except Exception as e:
            logger.error(f"Discord user info error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get Discord user info"
            )

    @staticmethod
    async def find_or_create_discord_user(
        session: AsyncSession,
        discord_data: dict[str, Any],
        token_data: dict[str, Any]
    ) -> models.AuthUser:
        """
        Find existing user by Discord ID or create new user
        """
        discord_id = int(discord_data["id"])
        
        # Check if Discord account is already linked
        result = await session.execute(
            select(models.AuthUserDiscord).where(
                models.AuthUserDiscord.discord_id == discord_id
            )
        )
        discord_link = result.scalar_one_or_none()
        
        if discord_link:
            # Update Discord info
            discord_link.discord_username = discord_data["username"]
            discord_link.discord_discriminator = discord_data.get("discriminator")
            discord_link.discord_avatar = discord_data.get("avatar")
            discord_link.discord_email = discord_data.get("email")
            discord_link.access_token = token_data["access_token"]
            discord_link.refresh_token = token_data.get("refresh_token")
            
            if "expires_in" in token_data:
                discord_link.token_expires_at = datetime.utcnow() + timedelta(seconds=token_data["expires_in"])
            
            await session.commit()
            await session.refresh(discord_link)
            
            # Load and return auth user
            result = await session.execute(
                select(models.AuthUser).where(models.AuthUser.id == discord_link.auth_user_id)
            )
            return result.scalar_one()
        
        # Create new auth user
        email = discord_data.get("email") or f"discord_{discord_id}@temp.local"
        username = discord_data["username"]
        
        # Check if username exists, add discriminator if needed
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.username == username)
        )
        if result.scalar_one_or_none():
            discriminator = discord_data.get("discriminator", "0000")
            username = f"{username}#{discriminator}"
        
        # Check if email exists
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.email == email)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        
        # Create auth user
        auth_user = models.AuthUser(
            email=email,
            username=username,
            hashed_password=None,  # OAuth users don't have password
            is_verified=discord_data.get("verified", False),
            avatar_url=f"https://cdn.discordapp.com/avatars/{discord_id}/{discord_data['avatar']}.png" if discord_data.get("avatar") else None
        )
        session.add(auth_user)
        await session.flush()
        
        # Create Discord link
        discord_link = models.AuthUserDiscord(
            auth_user_id=auth_user.id,
            discord_id=discord_id,
            discord_username=discord_data["username"],
            discord_discriminator=discord_data.get("discriminator"),
            discord_avatar=discord_data.get("avatar"),
            discord_email=discord_data.get("email"),
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_expires_at=datetime.utcnow() + timedelta(seconds=token_data["expires_in"]) if "expires_in" in token_data else None
        )
        session.add(discord_link)
        
        await session.commit()
        await session.refresh(auth_user)
        
        logger.success(f"Created new user via Discord OAuth: {auth_user.username}")
        return auth_user

    @staticmethod
    async def link_discord_to_existing_user(
        session: AsyncSession,
        auth_user: models.AuthUser,
        discord_data: dict[str, Any],
        token_data: dict[str, Any]
    ) -> models.AuthUserDiscord:
        """
        Link Discord account to existing auth user
        """
        discord_id = int(discord_data["id"])
        
        # Check if Discord is already linked to another user
        result = await session.execute(
            select(models.AuthUserDiscord).where(
                models.AuthUserDiscord.discord_id == discord_id
            )
        )
        existing_link = result.scalar_one_or_none()
        
        if existing_link:
            if existing_link.auth_user_id == auth_user.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Discord account already linked to your account"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Discord account already linked to another user"
                )
        
        # Create Discord link
        discord_link = models.AuthUserDiscord(
            auth_user_id=auth_user.id,
            discord_id=discord_id,
            discord_username=discord_data["username"],
            discord_discriminator=discord_data.get("discriminator"),
            discord_avatar=discord_data.get("avatar"),
            discord_email=discord_data.get("email"),
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            token_expires_at=datetime.utcnow() + timedelta(seconds=token_data["expires_in"]) if "expires_in" in token_data else None
        )
        session.add(discord_link)
        await session.commit()
        await session.refresh(discord_link)
        
        logger.success(f"Linked Discord account {discord_data['username']} to user {auth_user.username}")
        return discord_link

    @staticmethod
    async def unlink_discord(
        session: AsyncSession,
        auth_user: models.AuthUser
    ) -> None:
        """
        Unlink Discord account from auth user
        """
        result = await session.execute(
            select(models.AuthUserDiscord).where(
                models.AuthUserDiscord.auth_user_id == auth_user.id
            )
        )
        discord_link = result.scalar_one_or_none()
        
        if not discord_link:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No Discord account linked"
            )
        
        # Check if user has password (can't unlink if only OAuth)
        if not auth_user.hashed_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot unlink Discord - set a password first"
            )
        
        await session.delete(discord_link)
        await session.commit()
        
        logger.info(f"Unlinked Discord account from user {auth_user.username}")

    @staticmethod
    async def link_player(
        session: AsyncSession,
        auth_user: models.AuthUser,
        player_id: int,
        is_primary: bool = True
    ) -> models.AuthUserPlayer:
        """
        Link game player to auth user
        """
        # Check if player exists
        from shared.models.user import User
        result = await session.execute(
            select(User).where(User.id == player_id)
        )
        player = result.scalar_one_or_none()
        
        if not player:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Player not found"
            )
        
        # Check if player is already linked
        result = await session.execute(
            select(models.AuthUserPlayer).where(
                models.AuthUserPlayer.player_id == player_id
            )
        )
        existing_link = result.scalar_one_or_none()
        
        if existing_link:
            if existing_link.auth_user_id == auth_user.id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Player already linked to your account"
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Player already linked to another account"
                )
        
        # If setting as primary, unset other primary links
        if is_primary:
            result = await session.execute(
                select(models.AuthUserPlayer).where(
                    models.AuthUserPlayer.auth_user_id == auth_user.id,
                    models.AuthUserPlayer.is_primary == True
                )
            )
            for link in result.scalars():
                link.is_primary = False
        
        # Create player link
        player_link = models.AuthUserPlayer(
            auth_user_id=auth_user.id,
            player_id=player_id,
            is_primary=is_primary
        )
        session.add(player_link)
        await session.commit()
        await session.refresh(player_link)
        
        logger.success(f"Linked player {player.name} to user {auth_user.username}")
        return player_link

    @staticmethod
    async def unlink_player(
        session: AsyncSession,
        auth_user: models.AuthUser,
        player_id: int
    ) -> None:
        """
        Unlink game player from auth user
        """
        result = await session.execute(
            select(models.AuthUserPlayer).where(
                models.AuthUserPlayer.auth_user_id == auth_user.id,
                models.AuthUserPlayer.player_id == player_id
            )
        )
        player_link = result.scalar_one_or_none()
        
        if not player_link:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Player link not found"
            )
        
        await session.delete(player_link)
        await session.commit()
        
        logger.info(f"Unlinked player {player_id} from user {auth_user.username}")

    @staticmethod
    async def get_linked_players(
        session: AsyncSession,
        auth_user: models.AuthUser
    ) -> list[models.AuthUserPlayer]:
        """
        Get all linked players for auth user
        """
        from shared.models.user import User
        result = await session.execute(
            select(models.AuthUserPlayer)
            .where(models.AuthUserPlayer.auth_user_id == auth_user.id)
            .order_by(models.AuthUserPlayer.is_primary.desc(), models.AuthUserPlayer.created_at)
        )
        return list(result.scalars())
