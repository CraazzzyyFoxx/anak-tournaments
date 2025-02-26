import typing

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db
from src.models.hero import Hero
from src.models.tournament import Tournament

if typing.TYPE_CHECKING:
    from src.models.match import Match

__all__ = ("Achievement", "AchievementUser")


class Achievement(db.TimeStampIntegerMixin):
    __tablename__ = "achievement"

    name: Mapped[str] = mapped_column(String())
    slug: Mapped[str] = mapped_column(String())
    description_ru: Mapped[str] = mapped_column(String())
    description_en: Mapped[str] = mapped_column(String())
    hero_id: Mapped[int | None] = mapped_column(
        ForeignKey(Hero.id, ondelete="CASCADE"), nullable=True
    )


class AchievementUser(db.TimeStampIntegerMixin):
    __tablename__ = "achievement_user"

    user_id: Mapped[int] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    achievement_id: Mapped[int] = mapped_column(
        ForeignKey(Achievement.id, ondelete="CASCADE")
    )
    tournament_id: Mapped[int | None] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), nullable=True
    )
    match_id: Mapped[int | None] = mapped_column(
        ForeignKey("match.id", ondelete="CASCADE"), nullable=True
    )

    tournament: Mapped[Tournament] = relationship()
    match: Mapped[typing.Optional["Match"]] = relationship()
