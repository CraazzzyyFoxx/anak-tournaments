"""
Generic OAuth service for multiple providers
"""
import secrets
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone, UTC
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status
from shared.models.oauth import OAuthConnection
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core.config import settings
from src.core.logging import logger

if settings.proxy_ip:
    PROXY_CONF = f"http://{settings.proxy_username}:{settings.proxy_password}@{settings.proxy_ip}:{settings.proxy_port}"
else:
    PROXY_CONF = None


class OAuthProviderBase(ABC):
    """Base class for OAuth providers"""

    provider_name: str = "generic"

    @abstractmethod
    def get_authorization_url(self, state: str) -> str:
        """Get OAuth authorization URL"""

    @abstractmethod
    async def exchange_code(self, code: str) -> dict[str, Any]:
        """Exchange authorization code for access token"""

    @abstractmethod
    async def get_user_info(self, access_token: str) -> schemas.OAuthUserInfo:
        """Get user information from provider"""


class DiscordOAuthProvider(OAuthProviderBase):
    """Discord OAuth provider implementation"""

    provider_name = "discord"

    def get_authorization_url(self, state: str) -> str:
        """Get Discord OAuth authorization URL"""
        params = {
            "client_id": settings.DISCORD_CLIENT_ID,
            "redirect_uri": settings.DISCORD_REDIRECT_URI,
            "response_type": "code",
            "scope": "identify email",
            "state": state,
        }
        # Use urlencode to properly encode all parameters including redirect_uri
        return f"{settings.DISCORD_OAUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str) -> dict[str, Any]:
        """Exchange Discord authorization code for access token"""
        data = {
            "client_id": settings.DISCORD_CLIENT_ID,
            "client_secret": settings.DISCORD_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.DISCORD_REDIRECT_URI,
        }

        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
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
        except httpx.TimeoutException as exc:
            logger.error("Discord API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Discord service unavailable"
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Discord token exchange error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Discord authentication failed"
            ) from e

    async def get_user_info(self, access_token: str) -> schemas.OAuthUserInfo:
        """Get Discord user information"""
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
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

                user_data = response.json()

                return schemas.OAuthUserInfo(
                    provider=schemas.OAuthProvider.DISCORD,
                    provider_user_id=str(user_data["id"]),
                    email=user_data.get("email"),
                    username=user_data["username"],
                    display_name=user_data.get("global_name") or user_data["username"],
                    avatar_url=f"https://cdn.discordapp.com/avatars/{user_data['id']}/{user_data['avatar']}.png" if user_data.get("avatar") else None,
                    raw_data=user_data
                )
        except httpx.TimeoutException as exc:
            logger.error("Discord API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Discord service unavailable"
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Discord user info error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get Discord user info"
            ) from e


class OAuthService:
    """Generic OAuth service handling multiple providers"""

    # Registry of OAuth providers
    _providers: dict[str, OAuthProviderBase] = {
        "discord": DiscordOAuthProvider(),
        # Add more providers here as they're implemented
    }

    @classmethod
    def get_provider(cls, provider_name: str) -> OAuthProviderBase:
        """Get OAuth provider by name"""
        provider = cls._providers.get(provider_name)
        if not provider:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported OAuth provider: {provider_name}"
            )
        return provider

    @classmethod
    def generate_oauth_url(cls, provider_name: str, state: str | None = None) -> tuple[str, str]:
        """
        Generate OAuth URL for specified provider
        Returns (url, state)
        """
        if not state:
            state = secrets.token_urlsafe(32)

        provider = cls.get_provider(provider_name)
        url = provider.get_authorization_url(state)

        return url, state

    @classmethod
    async def handle_callback(
        cls,
        session: AsyncSession,
        provider_name: str,
        code: str
    ) -> tuple[models.AuthUser, dict[str, Any]]:
        """
        Handle OAuth callback for any provider
        Returns (auth_user, token_data)
        """
        provider = cls.get_provider(provider_name)

        # Exchange code for token
        token_data = await provider.exchange_code(code)

        # Get user info from provider
        oauth_user_info = await provider.get_user_info(token_data["access_token"])

        # Find or create user
        auth_user = await cls.find_or_create_oauth_user(
            session, oauth_user_info, token_data
        )

        return auth_user, token_data

    @classmethod
    async def find_or_create_oauth_user(
        cls,
        session: AsyncSession,
        oauth_info: schemas.OAuthUserInfo,
        token_data: dict[str, Any]
    ) -> models.AuthUser:
        """
        Find existing user by OAuth connection or create new user
        """
        # Check if OAuth connection already exists
        result = await session.execute(
            select(OAuthConnection).where(
                OAuthConnection.provider == oauth_info.provider.value,
                OAuthConnection.provider_user_id == oauth_info.provider_user_id
            )
        )
        oauth_conn = result.scalar_one_or_none()

        if oauth_conn:
            # Update OAuth connection info
            oauth_conn.username = oauth_info.username
            oauth_conn.display_name = oauth_info.display_name
            oauth_conn.avatar_url = oauth_info.avatar_url
            oauth_conn.email = oauth_info.email
            oauth_conn.access_token = token_data["access_token"]
            oauth_conn.refresh_token = token_data.get("refresh_token")

            if "expires_in" in token_data:
                oauth_conn.token_expires_at = datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])

            oauth_conn.provider_data = oauth_info.raw_data

            await session.commit()
            await session.refresh(oauth_conn)

            # Get associated auth user
            result = await session.execute(
                select(models.AuthUser).where(models.AuthUser.id == oauth_conn.auth_user_id)
            )
            auth_user = result.scalar_one()

            # Keep primary avatar in sync (used by /auth/me)
            if oauth_info.avatar_url and auth_user.avatar_url != oauth_info.avatar_url:
                auth_user.avatar_url = oauth_info.avatar_url
                await session.commit()
                await session.refresh(auth_user)

            logger.info(f"Existing {oauth_info.provider} user logged in: {oauth_info.username}")
            return auth_user

        # Check if user exists by email
        auth_user = None
        if oauth_info.email:
            result = await session.execute(
                select(models.AuthUser).where(models.AuthUser.email == oauth_info.email)
            )
            auth_user = result.scalar_one_or_none()

        # Create new user if doesn't exist
        if not auth_user:
            # Generate unique username
            base_username = oauth_info.username
            username = base_username
            counter = 1

            while True:
                result = await session.execute(
                    select(models.AuthUser).where(models.AuthUser.username == username)
                )
                if not result.scalar_one_or_none():
                    break
                username = f"{base_username}{counter}"
                counter += 1

            auth_user = models.AuthUser(
                email=oauth_info.email or f"{oauth_info.provider_user_id}@{oauth_info.provider}.oauth",
                username=username,
                hashed_password=None,  # OAuth users don't have password
                first_name=oauth_info.display_name,
                avatar_url=oauth_info.avatar_url,
                is_verified=bool(oauth_info.email),  # Consider verified if email provided
            )
            session.add(auth_user)
            await session.flush()  # Get the user ID

            logger.info(f"New user created via {oauth_info.provider}: {username}")

        # Create OAuth connection
        oauth_conn = OAuthConnection(
            auth_user_id=auth_user.id,
            provider=oauth_info.provider.value,
            provider_user_id=oauth_info.provider_user_id,
            email=oauth_info.email,
            username=oauth_info.username,
            display_name=oauth_info.display_name,
            avatar_url=oauth_info.avatar_url,
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            provider_data=oauth_info.raw_data,
            token_expires_at=datetime.now(UTC) + timedelta(seconds=token_data["expires_in"]) if "expires_in" in token_data else None
        )

        session.add(oauth_conn)
        await session.commit()
        await session.refresh(auth_user)

        logger.success(f"{oauth_info.provider.value.title()} account linked to user: {auth_user.username}")

        return auth_user

    @classmethod
    async def link_oauth_to_existing_user(
        cls,
        session: AsyncSession,
        auth_user: models.AuthUser,
        oauth_info: schemas.OAuthUserInfo,
        token_data: dict[str, Any]
    ) -> OAuthConnection:
        """
        Link OAuth provider to existing authenticated user
        """
        # Check if this OAuth account is already linked to another user
        result = await session.execute(
            select(OAuthConnection).where(
                OAuthConnection.provider == oauth_info.provider.value,
                OAuthConnection.provider_user_id == oauth_info.provider_user_id
            )
        )
        existing_conn = result.scalar_one_or_none()

        if existing_conn:
            if existing_conn.auth_user_id == auth_user.id:
                # Already linked to this user, just update tokens
                existing_conn.access_token = token_data["access_token"]
                existing_conn.refresh_token = token_data.get("refresh_token")

                if "expires_in" in token_data:
                    existing_conn.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])

                await session.commit()
                await session.refresh(existing_conn)
                return existing_conn
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"This {oauth_info.provider} account is already linked to another user"
                )

        # Create new OAuth connection
        oauth_conn = OAuthConnection(
            auth_user_id=auth_user.id,
            provider=oauth_info.provider.value,
            provider_user_id=oauth_info.provider_user_id,
            email=oauth_info.email,
            username=oauth_info.username,
            display_name=oauth_info.display_name,
            avatar_url=oauth_info.avatar_url,
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            provider_data=oauth_info.raw_data
        )

        if "expires_in" in token_data:
            oauth_conn.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])

        session.add(oauth_conn)
        await session.commit()
        await session.refresh(oauth_conn)

        logger.success(f"{oauth_info.provider.value.title()} account linked to user {auth_user.username}")

        return oauth_conn
