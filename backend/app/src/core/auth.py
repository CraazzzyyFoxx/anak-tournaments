"""
Authentication service for JWT-based authentication
Replaces Clerk authentication
"""
from datetime import datetime, timedelta
from typing import Annotated
import secrets

from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.context import CryptContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.src.clients.auth_client import auth_client
from app.src import models, schemas


async def get_current_user(
    token: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> models.AuthUser:
    """Get current authenticated user from JWT token"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = auth_client.validate_token(token.credentials)

        if not payload:
            raise credentials_exception

        user_id_str = payload.get("sub")
        
        if not user_id_str:
            raise credentials_exception
            
        user_id = int(user_id_str)
    except (KeyError):
        raise credentials_exception

    
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
