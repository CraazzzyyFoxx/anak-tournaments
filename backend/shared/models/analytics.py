from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.team import Player, Team
from shared.models.tournament import Tournament

__all__ = (
    "AnalyticsPlayer",
    "AnalyticsAlgorithm",
    "AnalyticsShift",
    "AnalyticsPredictions",
)


class AnalyticsPlayer(db.TimeStampIntegerMixin):
    __tablename__ = "tournament"
    __table_args__ = ({"schema": "analytics"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey(Player.id, ondelete="CASCADE"), index=True
    )
    wins: Mapped[int] = mapped_column()
    losses: Mapped[int] = mapped_column()
    shift_one: Mapped[int | None] = mapped_column(nullable=True)
    shift_two: Mapped[int | None] = mapped_column(nullable=True)
    shift: Mapped[int | None] = mapped_column(nullable=True)

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()


class AnalyticsAlgorithm(db.TimeStampIntegerMixin):
    __tablename__ = "algorithms"
    __table_args__ = ({"schema": "analytics"},)

    name: Mapped[str] = mapped_column(String(), unique=True)


class AnalyticsShift(db.TimeStampIntegerMixin):
    __tablename__ = "shifts"
    __table_args__ = ({"schema": "analytics"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    algorithm_id: Mapped[int] = mapped_column(
        ForeignKey(AnalyticsAlgorithm.id, ondelete="CASCADE"), index=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey(Player.id, ondelete="CASCADE"), index=True
    )
    shift: Mapped[float] = mapped_column()

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()


class AnalyticsPredictions(db.TimeStampIntegerMixin):
    __tablename__ = "predictions"
    __table_args__ = ({"schema": "analytics"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    algorithm_id: Mapped[int] = mapped_column(
        ForeignKey(AnalyticsAlgorithm.id, ondelete="CASCADE"), index=True
    )
    team_id: Mapped[int] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), index=True
    )
    predicted_place: Mapped[int] = mapped_column()
