"""
Authentication routes
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src.core import db
from src.core.logging import logger
from src import schemas, models
from src.services import auth_service

router = APIRouter(prefix="", tags=["Authentication"])


@router.post("/register", response_model=schemas.AuthUser, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: schemas.UserRegister,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """Register a new user"""
    logger.info(f"Registering new user: {user_data.email}")
    try:
        user = await auth_service.AuthService.create_user(session, user_data)
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


@router.post("/login", response_model=schemas.Token)
async def login(
    user_data: schemas.UserLogin,
    request: Request,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """Login and get access and refresh tokens"""
    logger.info(f"Login attempt for user: {user_data.email}")
    
    user = await auth_service.AuthService.authenticate_user(session, user_data.email, user_data.password)
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

    # Get user roles and permissions
    roles, permissions = auth_service.AuthService.get_user_roles_and_permissions(user)

    # Create access token with RBAC data
    access_token = auth_service.AuthService.create_access_token(
        data={
            "sub": str(user.id),
            "email": user.email,
            "username": user.username,
            "is_superuser": user.is_superuser,
            "roles": roles,
            "permissions": permissions,
        }
    )

    # Create and store refresh token
    refresh_token = auth_service.AuthService.create_refresh_token()
    await auth_service.AuthService.create_refresh_token_db(session, user.id, refresh_token, request)

    logger.success(f"User logged in successfully: {user.email}")
    return schemas.Token(
        access_token=access_token,
        refresh_token=refresh_token
    )


@router.post("/refresh", response_model=schemas.Token)
async def refresh_token(
    token_data: schemas.RefreshTokenRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """Refresh access token using refresh token"""
    logger.info("Token refresh attempt")
    
    user = await auth_service.AuthService.get_user_by_refresh_token(session, token_data.refresh_token)
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
    await auth_service.AuthService.revoke_refresh_token(session, token_data.refresh_token)

    # Get user roles and permissions
    roles, permissions = auth_service.AuthService.get_user_roles_and_permissions(user)

    # Create new tokens with RBAC data
    access_token = auth_service.AuthService.create_access_token(
        data={
            "sub": str(user.id),
            "email": user.email,
            "username": user.username,
            "is_superuser": user.is_superuser,
            "roles": roles,
            "permissions": permissions,
        }
    )

    new_refresh_token = auth_service.AuthService.create_refresh_token()
    await auth_service.AuthService.create_refresh_token_db(session, user.id, new_refresh_token, request)

    logger.success(f"Token refreshed for user: {user.email}")
    return schemas.Token(
        access_token=access_token,
        refresh_token=new_refresh_token
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    token_data: schemas.RefreshTokenRequest,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """Logout and revoke refresh token"""
    logger.info(f"Logout for user: {current_user.email}")
    
    await auth_service.AuthService.revoke_refresh_token(session, token_data.refresh_token)
    logger.success(f"User logged out: {current_user.email}")


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """Logout from all devices (revoke all refresh tokens)"""
    logger.info(f"Logout all devices for user: {current_user.email}")
    
    count = await auth_service.AuthService.revoke_all_user_tokens(session, current_user.id)
    logger.success(f"Revoked {count} tokens for user: {current_user.email}")


@router.get("/me", response_model=schemas.AuthUser)
async def get_current_user_info(
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """Get current user information"""
    return current_user


@router.patch("/me", response_model=schemas.AuthUser)
async def update_current_user(
    user_data: schemas.UserUpdate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """Update current user information"""
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


@router.post("/validate", response_model=schemas.TokenPayload)
async def validate_token(
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)]
):
    """
    Validate JWT token and return payload with RBAC data
    This endpoint is used by other microservices to validate tokens
    """
    roles, permissions = auth_service.AuthService.get_user_roles_and_permissions(current_user)
    
    return schemas.TokenPayload(
        sub=current_user.id,
        email=current_user.email,
        username=current_user.username,
        is_superuser=current_user.is_superuser,
        roles=roles,
        permissions=permissions
    )
