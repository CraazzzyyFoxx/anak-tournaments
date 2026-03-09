from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if TYPE_CHECKING:
    from shared.models.user import User
    from shared.models.rbac import Role
    from shared.models.oauth import OAuthConnection

__all__ = ("AuthUser", "RefreshToken", "AuthUserPlayer")


class AuthUser(db.TimeStampIntegerMixin):
    """User model for authentication"""
    __tablename__ = "auth_user"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Nullable for OAuth users
    is_active: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)
    
    # Optional profile fields
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    
    # Relations
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    player_links: Mapped[list["AuthUserPlayer"]] = relationship(
        back_populates="auth_user", cascade="all, delete-orphan"
    )
    roles: Mapped[list["Role"]] = relationship(
        secondary="user_roles",
        back_populates="users",
        lazy="selectin"
    )
    oauth_connections: Mapped[list["OAuthConnection"]] = relationship(
        back_populates="auth_user",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    def __repr__(self):
        return f"<AuthUser id={self.id} email={self.email}>"
    
    def has_permission(self, resource: str, action: str) -> bool:
        """Check if user has a specific permission"""
        if self.is_superuser:
            return True
        
        for role in self.roles:
            for permission in role.permissions:
                if permission.resource == resource and permission.action == action:
                    return True
                # Wildcard permissions
                if permission.resource == "*" and permission.action == action:
                    return True
                if permission.resource == resource and permission.action == "*":
                    return True
                if permission.resource == "*" and permission.action == "*":
                    return True
        
        return False
    
    def has_role(self, role_name: str) -> bool:
        """Check if user has a specific role"""
        if self.is_superuser:
            return True
        return any(role.name == role_name for role in self.roles)


class RefreshToken(db.TimeStampIntegerMixin):
    """Refresh token model for JWT authentication"""
    __tablename__ = "refresh_token"

    token: Mapped[str] = mapped_column(Text(), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("auth_user.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(db.DateTime(timezone=True), nullable=False)
    is_revoked: Mapped[bool] = mapped_column(Boolean(), default=False, nullable=False)
    
    # User agent and IP for security
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)

    # Relations
    user: Mapped["AuthUser"] = relationship(back_populates="refresh_tokens")

    def __repr__(self):
        return f"<RefreshToken id={self.id} user_id={self.user_id}>"


class AuthUserPlayer(db.TimeStampIntegerMixin):
    """Link between auth user and game player"""
    __tablename__ = "auth_user_player"

    auth_user_id: Mapped[int] = mapped_column(ForeignKey("auth_user.id", ondelete="CASCADE"), nullable=False)
    player_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), nullable=False, unique=True)
    is_primary: Mapped[bool] = mapped_column(Boolean(), default=True, nullable=False)

    # Relations
    auth_user: Mapped["AuthUser"] = relationship(back_populates="player_links")
    player: Mapped["User"] = relationship()

    def __repr__(self):
        return f"<AuthUserPlayer auth_user_id={self.auth_user_id} player_id={self.player_id}>"
