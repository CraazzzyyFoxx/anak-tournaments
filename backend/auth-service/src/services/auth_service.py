import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from loguru import logger
from shared.models.rbac import role_permissions, user_roles
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from src import models, schemas
from src.core import config, db

__all__ = [
    "AuthService",
    "get_current_user",
    "get_current_active_user",
    "get_current_superuser",
]

settings = config.settings
security = HTTPBearer()


class AuthService:
    """Service for handling authentication operations"""

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against a hash"""
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )

    @staticmethod
    def get_password_hash(password: str) -> str:
        """Generate password hash"""
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    @staticmethod
    def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
        """Create JWT access token with RBAC data"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(UTC) + expires_delta
        else:
            expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

        to_encode.update({"exp": expire, "type": "access"})
        encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        return encoded_jwt

    @staticmethod
    def create_service_token(data: dict, expires_delta: timedelta | None = None) -> str:
        """Create JWT service token for machine-to-machine auth."""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(UTC) + expires_delta
        else:
            expire = datetime.now(UTC) + timedelta(minutes=settings.SERVICE_ACCESS_TOKEN_EXPIRE_MINUTES)

        to_encode.update({"exp": expire, "type": "service"})
        encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        return encoded_jwt

    @staticmethod
    def get_user_roles_and_permissions(user: models.AuthUser) -> tuple[list[str], list[dict[str, str]]]:
        """Extract roles and permissions from user"""
        roles = [role.name for role in user.roles]
        permissions = []
        seen = set()

        for role in user.roles:
            for perm in role.permissions:
                key = f"{perm.resource}:{perm.action}"
                if key not in seen:
                    permissions.append({"resource": perm.resource, "action": perm.action})
                    seen.add(key)

        return roles, permissions

    @staticmethod
    async def get_user_roles_and_permissions_db(
        session: AsyncSession,
        user_id: int,
    ) -> tuple[list[str], list[dict[str, str]]]:
        """Fetch roles and permissions for a user via explicit SQL.

        This is async-safe and avoids ORM lazy-loading (which can raise
        `greenlet_spawn has not been called` with AsyncSession).
        """

        roles_result = await session.execute(
            select(models.Role.name)
            .select_from(user_roles.join(models.Role, user_roles.c.role_id == models.Role.id))
            .where(user_roles.c.user_id == user_id)
        )
        roles = list(roles_result.scalars().all())

        perms_result = await session.execute(
            select(models.Permission.resource, models.Permission.action)
            .select_from(
                user_roles.join(role_permissions, user_roles.c.role_id == role_permissions.c.role_id).join(
                    models.Permission, role_permissions.c.permission_id == models.Permission.id
                )
            )
            .where(user_roles.c.user_id == user_id)
        )

        permissions: list[dict[str, str]] = []
        seen: set[str] = set()
        for resource, action in perms_result.all():
            key = f"{resource}:{action}"
            if key in seen:
                continue
            seen.add(key)
            permissions.append({"resource": resource, "action": action})

        return roles, permissions

    @staticmethod
    def create_refresh_token() -> str:
        """Create a random refresh token"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def hash_refresh_token(token: str) -> str:
        """Hash refresh token before persistence/lookup."""
        return hmac.new(
            settings.JWT_SECRET_KEY.encode("utf-8"),
            token.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    @staticmethod
    def decode_token(token: str) -> dict:
        """Decode and validate JWT token"""
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_aud": False},
            )
            return payload
        except JWTError as e:
            logger.warning(f"Token decode error: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            ) from e

    @staticmethod
    def _user_query_with_rbac():
        """Select AuthUser with roles + permissions eagerly loaded.

        This avoids async SQLAlchemy lazy-loads (which would raise
        `greenlet_spawn has not been called` when accessing relationships).
        """

        return select(models.AuthUser).options(
            selectinload(models.AuthUser.roles).selectinload(models.Role.permissions)
        )

    @staticmethod
    async def get_user_with_rbac(session: AsyncSession, user_id: int) -> models.AuthUser | None:
        """Load a user with roles + permissions eagerly loaded."""
        result = await session.execute(AuthService._user_query_with_rbac().where(models.AuthUser.id == user_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def authenticate_user(session: AsyncSession, email: str, password: str) -> models.AuthUser | None:
        """Authenticate user by email and password"""
        result = await session.execute(AuthService._user_query_with_rbac().where(models.AuthUser.email == email))
        user = result.scalar_one_or_none()

        if not user:
            return None

        # OAuth users don't have password
        if not user.hashed_password:
            return None

        if not AuthService.verify_password(password, user.hashed_password):
            return None
        return user

    @staticmethod
    async def create_user(session: AsyncSession, user_data: schemas.UserRegister) -> models.AuthUser:
        """Create a new user"""
        # Check if email already exists
        result = await session.execute(select(models.AuthUser).where(models.AuthUser.email == user_data.email))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        # Check if username already exists
        result = await session.execute(select(models.AuthUser).where(models.AuthUser.username == user_data.username))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")

        # Create user
        user = models.AuthUser(
            email=user_data.email,
            username=user_data.username,
            hashed_password=AuthService.get_password_hash(user_data.password),
            first_name=user_data.first_name,
            last_name=user_data.last_name,
        )
        session.add(user)

        # Assign default "user" role if present.
        await session.flush()
        result = await session.execute(select(models.Role).where(models.Role.name == "user"))
        default_role = result.scalar_one_or_none()
        if default_role is not None:
            # Avoid ORM relationship lazy-loads with AsyncSession.
            await session.execute(insert(user_roles).values(user_id=user.id, role_id=default_role.id))

        await session.commit()
        await session.refresh(user)

        # Reload with RBAC to safely return schema (includes roles).
        result = await session.execute(AuthService._user_query_with_rbac().where(models.AuthUser.id == user.id))
        return result.scalar_one()

    @staticmethod
    async def create_refresh_token_db(
        session: AsyncSession,
        user_id: int,
        token: str,
        request: Request | None = None,
        commit: bool = True,
    ) -> models.RefreshToken:
        """Store refresh token in database"""
        expires_at = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        token_hash = AuthService.hash_refresh_token(token)

        refresh_token = models.RefreshToken(
            token=token_hash,
            user_id=user_id,
            expires_at=expires_at,
            user_agent=request.headers.get("user-agent") if request else None,
            ip_address=request.client.host if request and request.client else None,
        )
        session.add(refresh_token)
        if commit:
            await session.commit()
        return refresh_token

    @staticmethod
    async def get_user_by_refresh_token(session: AsyncSession, token: str) -> models.AuthUser | None:
        """Get user by refresh token"""
        token_hash = AuthService.hash_refresh_token(token)

        result = await session.execute(
            select(models.RefreshToken)
            .where(models.RefreshToken.token == token_hash)
            .where(models.RefreshToken.is_revoked.is_(False))
            .where(models.RefreshToken.expires_at > datetime.now(UTC))
        )
        refresh_token = result.scalar_one_or_none()

        if refresh_token:
            result = await session.execute(
                AuthService._user_query_with_rbac().where(models.AuthUser.id == refresh_token.user_id)
            )
            return result.scalar_one_or_none()

        # Reuse detection: known token hash already revoked/expired.
        result = await session.execute(select(models.RefreshToken).where(models.RefreshToken.token == token_hash))
        reused_token = result.scalar_one_or_none()
        if reused_token:
            logger.bind(user_id=str(reused_token.user_id)).error(
                "Refresh token reuse detected — possible token theft; revoking all active sessions"
            )
            await AuthService.revoke_all_user_tokens(session, reused_token.user_id)

        return None

    @staticmethod
    async def revoke_refresh_token(
        session: AsyncSession,
        token: str,
        commit: bool = True,
    ) -> bool:
        """Revoke a refresh token"""
        token_hash = AuthService.hash_refresh_token(token)
        result = await session.execute(select(models.RefreshToken).where(models.RefreshToken.token == token_hash))
        refresh_token = result.scalar_one_or_none()

        if not refresh_token:
            return False

        refresh_token.is_revoked = True
        if commit:
            await session.commit()
        return True

    @staticmethod
    async def revoke_all_user_tokens(
        session: AsyncSession,
        user_id: int,
        commit: bool = True,
    ) -> int:
        """Revoke all refresh tokens for a user"""
        result = await session.execute(
            select(models.RefreshToken)
            .where(models.RefreshToken.user_id == user_id)
            .where(models.RefreshToken.is_revoked.is_(False))
        )
        tokens = result.scalars().all()

        count = 0
        for token in tokens:
            token.is_revoked = True
            count += 1

        if commit:
            await session.commit()
        return count


async def get_current_user(
    token: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
) -> models.AuthUser:
    """Get current authenticated user from JWT token"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = AuthService.decode_token(token.credentials)
        user_id_str = payload.get("sub")
        token_type = payload.get("type")

        if not user_id_str or token_type != "access":
            raise credentials_exception

        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    result = await session.execute(AuthService._user_query_with_rbac().where(models.AuthUser.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception

    return user


async def get_current_active_user(
    current_user: Annotated[models.AuthUser, Depends(get_current_user)],
) -> models.AuthUser:
    """Get current active user"""
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


async def get_current_superuser(
    current_user: Annotated[models.AuthUser, Depends(get_current_active_user)],
) -> models.AuthUser:
    """Get current superuser"""
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not enough permissions")
    return current_user
