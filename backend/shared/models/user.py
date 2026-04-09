from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

__all__ = (
    "User",
    "UserDiscord",
    "UserBattleTag",
    "UserTwitch",
)


class User(db.TimeStampIntegerMixin):
    __tablename__ = "user"
    __table_args__ = ({"schema": "players"},)

    name: Mapped[str] = mapped_column(String(), unique=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    discord: Mapped[list["UserDiscord"]] = relationship(
        back_populates="user", uselist=True
    )
    battle_tag: Mapped[list["UserBattleTag"]] = relationship(
        back_populates="user", uselist=True
    )
    twitch: Mapped[list["UserTwitch"]] = relationship(
        back_populates="user", uselist=True
    )

    def __repr__(self):
        return f"<User id={self.id} name={self.name}>"


class UserDiscord(db.TimeStampIntegerMixin):
    __tablename__ = "discord"
    __table_args__ = ({"schema": "players"},)

    user_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    user: Mapped[User] = relationship()
    name: Mapped[str] = mapped_column(String(), unique=True, index=True)


class UserBattleTag(db.TimeStampIntegerMixin):
    __tablename__ = "battle_tag"
    __table_args__ = ({"schema": "players"},)

    user_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    user: Mapped[User] = relationship()
    name: Mapped[str] = mapped_column(String(), index=True)
    tag: Mapped[str] = mapped_column(String())
    battle_tag: Mapped[str] = mapped_column(String(), unique=True, index=True)


class UserTwitch(db.TimeStampIntegerMixin):
    __tablename__ = "twitch"
    __table_args__ = ({"schema": "players"},)

    user_id: Mapped[int] = mapped_column(ForeignKey(User.id, ondelete="CASCADE"))
    user: Mapped[User] = relationship()
    name: Mapped[str] = mapped_column(String(), unique=True, index=True)
