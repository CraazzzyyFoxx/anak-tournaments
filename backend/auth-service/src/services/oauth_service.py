"""
Generic OAuth service for multiple providers
"""

import base64
import hashlib
import hmac
import secrets
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import sqlalchemy as sa
from fastapi import HTTPException, status
from loguru import logger
from shared.models.oauth import OAuthConnection
from shared.models.rbac import user_roles
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core.config import settings

PROXY_CONF = settings.proxy_url


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
            "redirect_uri": settings.OAUTH_REDIRECT,
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
            "redirect_uri": settings.OAUTH_REDIRECT,
        }

        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
                response = await client.post(settings.DISCORD_TOKEN_URL, data=data, headers=headers, timeout=30.0)

                if response.status_code != 200:
                    logger.warning(
                        "Discord token exchange failed",
                        status_code=response.status_code,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to exchange Discord code"
                    )

                return response.json()
        except httpx.TimeoutException as exc:
            logger.error("Discord API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Discord service unavailable"
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Discord token exchange error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Discord authentication failed"
            ) from e

    async def get_user_info(self, access_token: str) -> schemas.OAuthUserInfo:
        """Get Discord user information"""
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
                response = await client.get(f"{settings.DISCORD_API_URL}/users/@me", headers=headers, timeout=30.0)

                if response.status_code != 200:
                    logger.warning(
                        "Discord user info request failed",
                        status_code=response.status_code,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to get Discord user info"
                    )

                user_data = response.json()

                return schemas.OAuthUserInfo(
                    provider=schemas.OAuthProvider.DISCORD,
                    provider_user_id=str(user_data["id"]),
                    email=user_data.get("email"),
                    username=user_data["username"],
                    display_name=user_data.get("global_name") or user_data["username"],
                    avatar_url=f"https://cdn.discordapp.com/avatars/{user_data['id']}/{user_data['avatar']}.png"
                    if user_data.get("avatar")
                    else None,
                    raw_data=user_data,
                )
        except httpx.TimeoutException as exc:
            logger.error("Discord API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Discord service unavailable"
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Discord user info error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get Discord user info"
            ) from e


class TwitchOAuthProvider(OAuthProviderBase):
    """Twitch OAuth provider implementation"""

    provider_name = "twitch"

    def get_authorization_url(self, state: str) -> str:
        params = {
            "client_id": settings.TWITCH_CLIENT_ID,
            "redirect_uri": settings.OAUTH_REDIRECT,
            "response_type": "code",
            "scope": "user:read:email",
            "state": state,
        }
        return f"{settings.TWITCH_OAUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str) -> dict[str, Any]:
        data = {
            "client_id": settings.TWITCH_CLIENT_ID,
            "client_secret": settings.TWITCH_CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.OAUTH_REDIRECT,
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
                response = await client.post(settings.TWITCH_TOKEN_URL, data=data, headers=headers, timeout=30.0)
                if response.status_code != 200:
                    logger.warning("Twitch token exchange failed", status_code=response.status_code)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to exchange Twitch code",
                    )
                return response.json()
        except httpx.TimeoutException as exc:
            logger.error("Twitch API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Twitch service unavailable",
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Twitch token exchange error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Twitch authentication failed",
            ) from e

    async def get_user_info(self, access_token: str) -> schemas.OAuthUserInfo:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Client-Id": settings.TWITCH_CLIENT_ID,
        }

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
                response = await client.get(f"{settings.TWITCH_API_URL}/users", headers=headers, timeout=30.0)

                if response.status_code != 200:
                    logger.warning("Twitch user info request failed", status_code=response.status_code)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to get Twitch user info",
                    )

                payload = response.json()
                users = payload.get("data") or []
                if not users:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Twitch user profile is empty",
                    )

                user_data = users[0]
                username = user_data.get("login") or user_data.get("display_name")
                if not username:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Twitch username is missing",
                    )

                return schemas.OAuthUserInfo(
                    provider=schemas.OAuthProvider.TWITCH,
                    provider_user_id=str(user_data["id"]),
                    email=user_data.get("email"),
                    username=username,
                    display_name=user_data.get("display_name") or username,
                    avatar_url=user_data.get("profile_image_url"),
                    raw_data=user_data,
                )
        except httpx.TimeoutException as exc:
            logger.error("Twitch API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Twitch service unavailable",
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Twitch user info error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get Twitch user info",
            ) from e


class BattleNetOAuthProvider(OAuthProviderBase):
    """Battle.net OAuth provider implementation"""

    provider_name = "battlenet"

    @staticmethod
    def _oauth_base_url() -> str:
        region = settings.BATTLENET_REGION.strip().lower() or "eu"
        return f"https://{region}.battle.net/oauth"

    def get_authorization_url(self, state: str) -> str:
        params = {
            "client_id": settings.BATTLENET_CLIENT_ID,
            "redirect_uri": settings.OAUTH_REDIRECT,
            "response_type": "code",
            "scope": "openid",
            "state": state,
        }
        return f"{self._oauth_base_url()}/authorize?{urlencode(params)}"

    async def exchange_code(self, code: str) -> dict[str, Any]:
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.OAUTH_REDIRECT,
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
                response = await client.post(
                    f"{self._oauth_base_url()}/token",
                    data=data,
                    headers=headers,
                    auth=(settings.BATTLENET_CLIENT_ID, settings.BATTLENET_CLIENT_SECRET),
                    timeout=30.0,
                )

                if response.status_code != 200:
                    logger.warning("Battle.net token exchange failed", status_code=response.status_code)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to exchange Battle.net code",
                    )

                return response.json()
        except httpx.TimeoutException as exc:
            logger.error("Battle.net API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Battle.net service unavailable",
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Battle.net token exchange error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Battle.net authentication failed",
            ) from e

    async def get_user_info(self, access_token: str) -> schemas.OAuthUserInfo:
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            async with httpx.AsyncClient(proxy=PROXY_CONF) as client:
                response = await client.get(f"{self._oauth_base_url()}/userinfo", headers=headers, timeout=30.0)

                if response.status_code != 200:
                    logger.warning("Battle.net user info request failed", status_code=response.status_code)
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to get Battle.net user info",
                    )

                user_data = response.json()
                provider_user_id = str(user_data.get("sub") or "")
                if not provider_user_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Battle.net user id is missing",
                    )

                battletag = (
                    user_data.get("battletag")
                    or user_data.get("battle_tag")
                    or user_data.get("preferred_username")
                    or provider_user_id
                )

                return schemas.OAuthUserInfo(
                    provider=schemas.OAuthProvider.BATTLENET,
                    provider_user_id=provider_user_id,
                    email=user_data.get("email"),
                    username=battletag,
                    display_name=battletag,
                    avatar_url=None,
                    raw_data=user_data,
                )
        except httpx.TimeoutException as exc:
            logger.error("Battle.net API timeout")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Battle.net service unavailable",
            ) from exc
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Battle.net user info error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get Battle.net user info",
            ) from e


class OAuthService:
    """Generic OAuth service handling multiple providers"""

    # Registry of OAuth providers
    _providers: dict[str, OAuthProviderBase] = {
        "discord": DiscordOAuthProvider(),
        "twitch": TwitchOAuthProvider(),
        "battlenet": BattleNetOAuthProvider(),
    }

    _provider_settings: dict[str, dict[str, str]] = {
        "discord": {
            "enabled": "DISCORD_OAUTH_ENABLED",
            "client_id": "DISCORD_CLIENT_ID",
            "client_secret": "DISCORD_CLIENT_SECRET",
            "redirect_uri": "OAUTH_REDIRECT",
        },
        "twitch": {
            "enabled": "TWITCH_OAUTH_ENABLED",
            "client_id": "TWITCH_CLIENT_ID",
            "client_secret": "TWITCH_CLIENT_SECRET",
            "redirect_uri": "OAUTH_REDIRECT",
        },
        "battlenet": {
            "enabled": "BATTLENET_OAUTH_ENABLED",
            "client_id": "BATTLENET_CLIENT_ID",
            "client_secret": "BATTLENET_CLIENT_SECRET",
            "redirect_uri": "OAUTH_REDIRECT",
        },
    }

    _state_prefix = "v1"

    @classmethod
    def _provider_config(cls, provider_name: str) -> dict[str, str]:
        provider_config = cls._provider_settings.get(provider_name)
        if not provider_config:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported OAuth provider: {provider_name}"
            )
        return provider_config

    @classmethod
    def is_provider_enabled(cls, provider_name: str) -> bool:
        provider_config = cls._provider_config(provider_name)
        enabled = bool(getattr(settings, provider_config["enabled"], False))
        if not enabled:
            return False

        required_settings = (
            provider_config["client_id"],
            provider_config["client_secret"],
            provider_config["redirect_uri"],
        )
        return all(bool(getattr(settings, setting_name, None)) for setting_name in required_settings)

    @classmethod
    def get_available_providers(cls) -> list[schemas.OAuthProvider]:
        return [
            schemas.OAuthProvider(provider_name)
            for provider_name in cls._providers
            if cls.is_provider_enabled(provider_name)
        ]

    @classmethod
    def ensure_provider_enabled(cls, provider_name: str) -> None:
        cls._provider_config(provider_name)
        if not cls.is_provider_enabled(provider_name):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"OAuth provider '{provider_name}' is disabled",
            )

    @staticmethod
    def _encode_state_part(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    @staticmethod
    def _decode_state_part(encoded: str) -> bytes:
        padded = encoded + ("=" * ((4 - len(encoded) % 4) % 4))
        return base64.urlsafe_b64decode(padded.encode("utf-8"))

    @classmethod
    def _build_state_signature(cls, provider_name: str, issued_at: int, nonce: str) -> str:
        payload = f"oauth-state:{provider_name}:{issued_at}:{nonce}".encode()
        digest = hmac.new(
            settings.JWT_SECRET_KEY.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).digest()
        return cls._encode_state_part(digest)

    @classmethod
    def generate_oauth_state(cls, provider_name: str) -> str:
        nonce = cls._encode_state_part(secrets.token_bytes(24))
        issued_at = int(datetime.now(UTC).timestamp())
        signature = cls._build_state_signature(provider_name, issued_at, nonce)
        return f"{cls._state_prefix}.{issued_at}.{nonce}.{signature}"

    @classmethod
    def validate_oauth_state(cls, provider_name: str, state: str) -> None:
        try:
            version, issued_at_raw, nonce, signature = state.split(".", maxsplit=3)
            if version != cls._state_prefix:
                raise ValueError("invalid state version")

            issued_at = int(issued_at_raw)
            now_ts = int(datetime.now(UTC).timestamp())
            state_ttl_seconds = max(settings.OAUTH_STATE_EXPIRE_MINUTES, 1) * 60
            if issued_at > now_ts + 60 or now_ts - issued_at > state_ttl_seconds:
                raise ValueError("state expired")

            expected_sig = cls._build_state_signature(provider_name, issued_at, nonce)
            if not hmac.compare_digest(signature, expected_sig):
                raise ValueError("invalid signature")

            # Validate nonce is valid base64url
            cls._decode_state_part(nonce)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired OAuth state",
            ) from exc

    @classmethod
    def get_provider(cls, provider_name: str) -> OAuthProviderBase:
        """Get OAuth provider by name"""
        cls.ensure_provider_enabled(provider_name)
        provider = cls._providers.get(provider_name)
        if not provider:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported OAuth provider: {provider_name}"
            )
        return provider

    @classmethod
    def generate_oauth_url(cls, provider_name: str, state: str | None = None) -> tuple[str, str]:
        """
        Generate OAuth URL for specified provider
        Returns (url, state)
        """
        if not state:
            state = cls.generate_oauth_state(provider_name)

        provider = cls.get_provider(provider_name)
        url = provider.get_authorization_url(state)

        return url, state

    @classmethod
    async def handle_callback(
        cls, session: AsyncSession, provider_name: str, code: str
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
        auth_user = await cls.find_or_create_oauth_user(session, oauth_user_info, token_data)

        return auth_user, token_data

    @classmethod
    async def find_or_create_oauth_user(
        cls, session: AsyncSession, oauth_info: schemas.OAuthUserInfo, token_data: dict[str, Any]
    ) -> models.AuthUser:
        """
        Find existing user by OAuth connection or create new user
        """
        # Check if OAuth connection already exists
        result = await session.execute(
            select(OAuthConnection).where(
                OAuthConnection.provider == oauth_info.provider.value,
                OAuthConnection.provider_user_id == oauth_info.provider_user_id,
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
            result = await session.execute(select(models.AuthUser).where(models.AuthUser.id == oauth_conn.auth_user_id))
            auth_user = result.scalar_one()

            # Keep primary avatar in sync (used by /me)
            if oauth_info.avatar_url and auth_user.avatar_url != oauth_info.avatar_url:
                auth_user.avatar_url = oauth_info.avatar_url
                await session.commit()
                await session.refresh(auth_user)

            logger.info(f"Existing {oauth_info.provider} user logged in: {oauth_info.username}")
            return auth_user

        auth_user = None

        # Create new user if doesn't exist
        if not auth_user:
            # Generate unique username
            base_username = oauth_info.username
            username = base_username
            counter = 1

            while True:
                result = await session.execute(select(models.AuthUser).where(models.AuthUser.username == username))
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
                is_verified=bool(oauth_info.raw_data.get("verified")),
            )
            session.add(auth_user)
            try:
                await session.flush()  # Get the user ID

                # Assign default "user" role if present.
                result = await session.execute(select(models.Role).where(models.Role.name == "user"))
                default_role = result.scalar_one_or_none()
                if default_role is not None:
                    # Avoid ORM relationship lazy-loads with AsyncSession.
                    await session.execute(sa.insert(user_roles).values(user_id=auth_user.id, role_id=default_role.id))
            except IntegrityError as exc:
                await session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "OAuth email already belongs to an existing account. "
                        "Sign in first and link this OAuth provider from account settings."
                    ),
                ) from exc

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
            token_expires_at=datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])
            if "expires_in" in token_data
            else None,
        )

        session.add(oauth_conn)
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This OAuth account is already linked",
            ) from exc
        await session.refresh(auth_user)

        logger.success(f"{oauth_info.provider.value.title()} account linked to user: {auth_user.username}")

        return auth_user

    @classmethod
    async def link_oauth_to_existing_user(
        cls,
        session: AsyncSession,
        auth_user: models.AuthUser,
        oauth_info: schemas.OAuthUserInfo,
        token_data: dict[str, Any],
    ) -> OAuthConnection:
        """
        Link OAuth provider to existing authenticated user
        """
        # Check if this OAuth account is already linked to another user
        result = await session.execute(
            select(OAuthConnection).where(
                OAuthConnection.provider == oauth_info.provider.value,
                OAuthConnection.provider_user_id == oauth_info.provider_user_id,
            )
        )
        existing_conn = result.scalar_one_or_none()

        # Enforce one connection per provider per auth user.
        result = await session.execute(
            select(OAuthConnection).where(
                OAuthConnection.auth_user_id == auth_user.id,
                OAuthConnection.provider == oauth_info.provider.value,
            )
        )
        current_provider_conn = result.scalar_one_or_none()

        if current_provider_conn and current_provider_conn.provider_user_id != oauth_info.provider_user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"A different {oauth_info.provider.value} account is already linked. "
                    "Unlink it first before linking another one."
                ),
            )

        if existing_conn:
            if existing_conn.auth_user_id == auth_user.id:
                # Already linked to this user, just update tokens
                existing_conn.access_token = token_data["access_token"]
                existing_conn.refresh_token = token_data.get("refresh_token")

                if "expires_in" in token_data:
                    existing_conn.token_expires_at = datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])

                await session.commit()
                await session.refresh(existing_conn)
                return existing_conn
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"This {oauth_info.provider} account is already linked to another user",
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
            provider_data=oauth_info.raw_data,
        )

        if "expires_in" in token_data:
            oauth_conn.token_expires_at = datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])

        session.add(oauth_conn)
        await session.commit()
        await session.refresh(oauth_conn)

        logger.success(f"{oauth_info.provider.value.title()} account linked to user {auth_user.username}")

        return oauth_conn
