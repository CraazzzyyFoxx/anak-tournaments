from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, ForeignKey, String, Text, BigInteger
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if TYPE_CHECKING:
    from shared.models.user import User

__all__ = ("AuthUser", "RefreshToken", "AuthUserDiscord", "AuthUserPlayer")


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
    discord_accounts: Mapped[list["AuthUserDiscord"]] = relationship(
        back_populates="auth_user", cascade="all, delete-orphan"
    )
    player_links: Mapped[list["AuthUserPlayer"]] = relationship(
        back_populates="auth_user", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<AuthUser id={self.id} email={self.email}>"


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


class AuthUserDiscord(db.TimeStampIntegerMixin):
    """Discord OAuth connection for auth users"""
    __tablename__ = "auth_user_discord"

    auth_user_id: Mapped[int] = mapped_column(ForeignKey("auth_user.id", ondelete="CASCADE"), nullable=False)
    discord_id: Mapped[int] = mapped_column(BigInteger(), unique=True, index=True, nullable=False)
    discord_username: Mapped[str] = mapped_column(String(100), nullable=False)
    discord_discriminator: Mapped[str | None] = mapped_column(String(10), nullable=True)
    discord_avatar: Mapped[str | None] = mapped_column(String(500), nullable=True)
    discord_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    
    access_token: Mapped[str | None] = mapped_column(Text(), nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text(), nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(db.DateTime(timezone=True), nullable=True)

    # Relations
    auth_user: Mapped["AuthUser"] = relationship(back_populates="discord_accounts")

    def __repr__(self):
        return f"<AuthUserDiscord id={self.id} discord_id={self.discord_id} username={self.discord_username}>"


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
