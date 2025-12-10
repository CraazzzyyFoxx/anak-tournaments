"""
Authentication service
Handles JWT tokens, password hashing, and user authentication
"""
from datetime import datetime, timedelta
from typing import Annotated
import secrets

from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src.core import db, config
from src.core.logging import logger
from src import models, schemas

__all__ = [
    "AuthService",
    "get_current_user",
    "get_current_active_user",
    "get_current_superuser",
]

settings = config.settings
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthService:
    """Service for handling authentication operations"""

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        """Verify a password against a hash"""
        return pwd_context.verify(plain_password, hashed_password)

    @staticmethod
    def get_password_hash(password: str) -> str:
        """Generate password hash"""
        return pwd_context.hash(password)

    @staticmethod
    def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
        """Create JWT access token"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({"exp": expire, "type": "access"})
        encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        return encoded_jwt

    @staticmethod
    def create_refresh_token() -> str:
        """Create a random refresh token"""
        return secrets.token_urlsafe(32)

    @staticmethod
    def decode_token(token: str) -> dict:
        """Decode and validate JWT token"""
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            return payload
        except JWTError as e:
            logger.warning(f"Token decode error: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

    @staticmethod
    async def authenticate_user(
        session: AsyncSession,
        email: str,
        password: str
    ) -> models.AuthUser | None:
        """Authenticate user by email and password"""
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.email == email)
        )
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
    async def create_user(
        session: AsyncSession,
        user_data: schemas.UserRegister
    ) -> models.AuthUser:
        """Create a new user"""
        # Check if email already exists
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.email == user_data.email)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )

        # Check if username already exists
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.username == user_data.username)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )

        # Create user
        user = models.AuthUser(
            email=user_data.email,
            username=user_data.username,
            hashed_password=AuthService.get_password_hash(user_data.password),
            first_name=user_data.first_name,
            last_name=user_data.last_name,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user

    @staticmethod
    async def create_refresh_token_db(
        session: AsyncSession,
        user_id: int,
        token: str,
        request: Request | None = None
    ) -> models.RefreshToken:
        """Store refresh token in database"""
        expires_at = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        
        refresh_token = models.RefreshToken(
            token=token,
            user_id=user_id,
            expires_at=expires_at,
            user_agent=request.headers.get("user-agent") if request else None,
            ip_address=request.client.host if request and request.client else None,
        )
        session.add(refresh_token)
        await session.commit()
        return refresh_token

    @staticmethod
    async def get_user_by_refresh_token(
        session: AsyncSession,
        token: str
    ) -> models.AuthUser | None:
        """Get user by refresh token"""
        result = await session.execute(
            select(models.RefreshToken)
            .where(models.RefreshToken.token == token)
            .where(models.RefreshToken.is_revoked == False)
            .where(models.RefreshToken.expires_at > datetime.utcnow())
        )
        refresh_token = result.scalar_one_or_none()
        
        if not refresh_token:
            return None

        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.id == refresh_token.user_id)
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def revoke_refresh_token(
        session: AsyncSession,
        token: str
    ) -> bool:
        """Revoke a refresh token"""
        result = await session.execute(
            select(models.RefreshToken).where(models.RefreshToken.token == token)
        )
        refresh_token = result.scalar_one_or_none()
        
        if not refresh_token:
            return False

        refresh_token.is_revoked = True
        await session.commit()
        return True

    @staticmethod
    async def revoke_all_user_tokens(
        session: AsyncSession,
        user_id: int
    ) -> int:
        """Revoke all refresh tokens for a user"""
        result = await session.execute(
            select(models.RefreshToken)
            .where(models.RefreshToken.user_id == user_id)
            .where(models.RefreshToken.is_revoked == False)
        )
        tokens = result.scalars().all()
        
        count = 0
        for token in tokens:
            token.is_revoked = True
            count += 1
        
        await session.commit()
        return count


async def get_current_user(
    token: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
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

    result = await session.execute(
        select(models.AuthUser).where(models.AuthUser.id == user_id)
    )
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(
    current_user: Annotated[models.AuthUser, Depends(get_current_user)]
) -> models.AuthUser:
    """Get current active user"""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user"
        )
    return current_user


async def get_current_superuser(
    current_user: Annotated[models.AuthUser, Depends(get_current_active_user)]
) -> models.AuthUser:
    """Get current superuser"""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    return current_user
