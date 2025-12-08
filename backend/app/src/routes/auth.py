"""
Authentication routes
Handles user registration, login, token refresh, and logout
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from loguru import logger

from src.core import db, auth, enums
from src import schemas, models

router = APIRouter(prefix="/auth", tags=[enums.RouteTag.USER])


@router.post("/register", response_model=schemas.auth.AuthUser, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: schemas.auth.UserRegister,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """
    Register a new user
    """
    logger.info(f"Registering new user: {user_data.email}")
    try:
        user = await auth.AuthService.create_user(session, user_data)
        logger.success(f"User registered successfully: {user.email}")
        return user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during registration: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration failed"
        )


@router.post("/login", response_model=schemas.auth.Token)
async def login(
    user_data: schemas.auth.UserLogin,
    request: Request,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """
    Login and get access and refresh tokens
    """
    logger.info(f"Login attempt for user: {user_data.email}")
    
    user = await auth.AuthService.authenticate_user(session, user_data.email, user_data.password)
    if not user:
        logger.warning(f"Failed login attempt for: {user_data.email}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning(f"Login attempt for inactive user: {user_data.email}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    # Create access token
    access_token = auth.AuthService.create_access_token(
        data={
            "sub": str(user.id),
            "email": user.email,
            "username": user.username,
            "is_superuser": user.is_superuser,
        }
    )

    # Create and store refresh token
    refresh_token = auth.AuthService.create_refresh_token()
    await auth.AuthService.create_refresh_token_db(session, user.id, refresh_token, request)

    logger.success(f"User logged in successfully: {user.email}")
    return schemas.auth.Token(
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/refresh", response_model=schemas.auth.Token)
async def refresh_token(
    token_data: schemas.auth.RefreshTokenRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """
    Refresh access token using refresh token
    """
    logger.info("Token refresh attempt")
    
    user = await auth.AuthService.get_user_by_refresh_token(session, token_data.refresh_token)
    if not user:
        logger.warning("Invalid or expired refresh token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )

    if not user.is_active:
        logger.warning(f"Token refresh for inactive user: {user.email}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )

    # Revoke old refresh token
    await auth.AuthService.revoke_refresh_token(session, token_data.refresh_token)

    # Create new tokens
    access_token = auth.AuthService.create_access_token(
        data={
            "sub": str(user.id),
            "email": user.email,
            "username": user.username,
            "is_superuser": user.is_superuser,
        }
    )

    new_refresh_token = auth.AuthService.create_refresh_token()
    await auth.AuthService.create_refresh_token_db(session, user.id, new_refresh_token, request)

    logger.success(f"Token refreshed for user: {user.email}")
    return schemas.auth.Token(
        access_token=access_token,
        refresh_token=new_refresh_token
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    token_data: schemas.auth.RefreshTokenRequest,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth.get_current_active_user)]
):
    """
    Logout and revoke refresh token
    """
    logger.info(f"Logout for user: {current_user.email}")
    
    await auth.AuthService.revoke_refresh_token(session, token_data.refresh_token)
    logger.success(f"User logged out: {current_user.email}")


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth.get_current_active_user)]
):
    """
    Logout from all devices (revoke all refresh tokens)
    """
    logger.info(f"Logout all devices for user: {current_user.email}")
    
    count = await auth.AuthService.revoke_all_user_tokens(session, current_user.id)
    logger.success(f"Revoked {count} tokens for user: {current_user.email}")


@router.get("/me", response_model=schemas.auth.AuthUser)
async def get_current_user_info(
    current_user: Annotated[models.AuthUser, Depends(auth.get_current_active_user)]
):
    """
    Get current user information
    """
    return current_user


@router.patch("/me", response_model=schemas.auth.AuthUser)
async def update_current_user(
    user_data: schemas.auth.UserUpdate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth.get_current_active_user)]
):
    """
    Update current user information
    """
    logger.info(f"Updating user: {current_user.email}")
    
    if user_data.first_name is not None:
        current_user.first_name = user_data.first_name
    if user_data.last_name is not None:
        current_user.last_name = user_data.last_name
    if user_data.email is not None and user_data.email != current_user.email:
        # Check if new email is already taken
        from sqlalchemy import select
        result = await session.execute(
            select(models.AuthUser).where(models.AuthUser.email == user_data.email)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        current_user.email = user_data.email

    await session.commit()
    await session.refresh(current_user)
    
    logger.success(f"User updated: {current_user.email}")
    return current_user
