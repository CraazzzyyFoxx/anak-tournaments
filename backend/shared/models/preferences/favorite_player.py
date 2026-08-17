from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.identity.auth_user import AuthUser
from shared.models.identity.user import User

__all__ = ("FavoritePlayer",)


class FavoritePlayer(db.TimeStampIntegerMixin):
    """A visitor's own bookmark on another (or their own) player. Auth-account
    scoped, not player-scoped — the caller's `auth.user` id owns the row, so it
    survives a player being re-linked/merged and requires no player of the
    caller's own to exist."""

    __tablename__ = "favorite_player"
    __table_args__ = (
        UniqueConstraint("auth_user_id", "player_id", name="uq_favorite_player_auth_user_player"),
        Index("ix_favorite_player_auth_user", "auth_user_id"),
        {"schema": "players"},
    )

    auth_user_id: Mapped[int] = mapped_column(ForeignKey(AuthUser.id, ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"), index=True)

    auth_user: Mapped[AuthUser] = relationship()
    player: Mapped[User] = relationship()
