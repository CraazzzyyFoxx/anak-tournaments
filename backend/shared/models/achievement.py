import typing

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.hero import Hero
from shared.models.tournament import Tournament
from shared.models.user import User

if typing.TYPE_CHECKING:
    from shared.models.match import Match

__all__ = ("Achievement", "AchievementUser")


class Achievement(db.TimeStampIntegerMixin):
    __tablename__ = "achievement"
    __table_args__ = ({"schema": "achievements"},)

    name: Mapped[str] = mapped_column(String())
    slug: Mapped[str] = mapped_column(String(), unique=True, index=True)
    description_ru: Mapped[str] = mapped_column(String())
    description_en: Mapped[str] = mapped_column(String())
    image_url: Mapped[str | None] = mapped_column(String(), nullable=True)
    hero_id: Mapped[int | None] = mapped_column(
        ForeignKey(Hero.id, ondelete="CASCADE"), nullable=True
    )

    hero: Mapped[Hero | None] = relationship()


class AchievementUser(db.TimeStampIntegerMixin):
    __tablename__ = "user"
    __table_args__ = ({"schema": "achievements"},)

    user_id: Mapped[int] = mapped_column(ForeignKey("players.user.id", ondelete="CASCADE"))
    achievement_id: Mapped[int] = mapped_column(
        ForeignKey(Achievement.id, ondelete="CASCADE")
    )
    tournament_id: Mapped[int | None] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), nullable=True
    )
    match_id: Mapped[int | None] = mapped_column(
        ForeignKey("matches.match.id", ondelete="CASCADE"), nullable=True
    )

    tournament: Mapped[Tournament] = relationship()
    achievement: Mapped[Achievement] = relationship()
    match: Mapped[typing.Optional["Match"]] = relationship()
    user: Mapped[User] = relationship()
