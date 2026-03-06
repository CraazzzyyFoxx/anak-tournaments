"""
Authentication routes
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from src import models, schemas
from src.core import db
from src.services import auth_service
from src.services.oauth_service import OAuthService

router = APIRouter(tags=["Authentication"])


@router.get("/providers", response_model=list[schemas.OAuthProviderAvailability])
async def list_available_oauth_providers():
    """List OAuth providers available for frontend auth flows."""

    return [schemas.OAuthProviderAvailability(provider=provider) for provider in OAuthService.get_available_providers()]


@router.post("/register", response_model=schemas.AuthUser, status_code=status.HTTP_201_CREATED)
async def register(user_data: schemas.UserRegister, session: Annotated[AsyncSession, Depends(db.get_async_session)]):
    """Register a new user"""
    logger.info("Registering new user")
    try:
        user = await auth_service.AuthService.create_user(session, user_data)
        logger.bind(user_id=str(user.id)).success("User registered successfully")
        return user
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error during registration")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Registration failed")


@router.post("/login", response_model=schemas.Token)
async def login(
    user_data: schemas.UserLogin, request: Request, session: Annotated[AsyncSession, Depends(db.get_async_session)]
):
    """Login and get access and refresh tokens"""
    logger.info("Login attempt")

    user = await auth_service.AuthService.authenticate_user(session, user_data.email, user_data.password)
    if not user:
        logger.warning("Failed login attempt — bad credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.bind(user_id=str(user.id)).warning("Login attempt for inactive user")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive")

    # Get user roles and permissions (async-safe)
    roles, permissions = await auth_service.AuthService.get_user_roles_and_permissions_db(session, user.id)

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

    logger.bind(user_id=str(user.id)).success("User logged in successfully")
    return schemas.Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=schemas.Token)
async def refresh_token(
    token_data: schemas.RefreshTokenRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
):
    """Refresh access token using refresh token"""
    logger.info("Token refresh attempt")

    user = await auth_service.AuthService.get_user_by_refresh_token(session, token_data.refresh_token)
    if not user:
        logger.warning("Invalid or expired refresh token")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    if not user.is_active:
        logger.bind(user_id=str(user.id)).warning("Token refresh for inactive user")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive")

    # Revoke old refresh token and issue a new one atomically.
    revoked = await auth_service.AuthService.revoke_refresh_token(
        session,
        token_data.refresh_token,
        commit=False,
    )
    if not revoked:
        logger.warning("Refresh token became invalid during rotation")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    # Get user roles and permissions (async-safe)
    roles, permissions = await auth_service.AuthService.get_user_roles_and_permissions_db(session, user.id)

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
    await auth_service.AuthService.create_refresh_token_db(
        session,
        user.id,
        new_refresh_token,
        request,
        commit=False,
    )
    await session.commit()

    logger.bind(user_id=str(user.id)).success("Token refreshed")
    return schemas.Token(access_token=access_token, refresh_token=new_refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    token_data: schemas.RefreshTokenRequest,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Logout and revoke refresh token"""
    logger.bind(user_id=str(current_user.id)).info("Logout")

    await auth_service.AuthService.revoke_refresh_token(session, token_data.refresh_token)
    logger.bind(user_id=str(current_user.id)).success("User logged out")


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Logout from all devices (revoke all refresh tokens)"""
    logger.bind(user_id=str(current_user.id)).info("Logout all devices")

    count = await auth_service.AuthService.revoke_all_user_tokens(session, current_user.id)
    logger.bind(user_id=str(current_user.id), count=count).success("Revoked all tokens")


@router.get("/me", response_model=schemas.AuthUser)
async def get_current_user_info(
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Get current user information"""
    return current_user


@router.patch("/me", response_model=schemas.AuthUser)
async def update_current_user(
    user_data: schemas.UserUpdate,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Update current user information"""
    logger.bind(user_id=str(current_user.id)).info("Updating user profile")

    if user_data.first_name is not None:
        current_user.first_name = user_data.first_name
    if user_data.last_name is not None:
        current_user.last_name = user_data.last_name
    if user_data.email is not None and user_data.email != current_user.email:
        # Check if new email is already taken
        from sqlalchemy import select

        result = await session.execute(select(models.AuthUser).where(models.AuthUser.email == user_data.email))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
        current_user.email = user_data.email

    await session.commit()
    await session.refresh(current_user)

    logger.bind(user_id=str(current_user.id)).success("User profile updated")
    return current_user


@router.post("/set-password", status_code=status.HTTP_204_NO_CONTENT)
async def set_password(
    payload: schemas.PasswordSetRequest,
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """Set password for OAuth-only users or change existing password."""
    if current_user.hashed_password:
        if not payload.current_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is required")
        if not auth_service.AuthService.verify_password(payload.current_password, current_user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")

    current_user.hashed_password = auth_service.AuthService.get_password_hash(payload.new_password)
    await session.commit()

    logger.bind(user_id=str(current_user.id)).success("Password updated")


@router.post("/validate", response_model=schemas.TokenPayload)
async def validate_token(
    session: Annotated[AsyncSession, Depends(db.get_async_session)],
    current_user: Annotated[models.AuthUser, Depends(auth_service.get_current_active_user)],
):
    """
    Validate JWT token and return payload with RBAC data
    This endpoint is used by other microservices to validate tokens
    """
    roles, permissions = await auth_service.AuthService.get_user_roles_and_permissions_db(session, current_user.id)

    return schemas.TokenPayload(
        sub=current_user.id,
        email=current_user.email,
        username=current_user.username,
        is_superuser=current_user.is_superuser,
        roles=roles,
        permissions=permissions,
    )
