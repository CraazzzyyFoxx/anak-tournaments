from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db
from src.models.team import Player, Team
from src.models.tournament import Tournament

__all__ = (
    "AnalyticsPlayer",
    "AnalyticsAlgorithm",
    "AnalyticsShift",
    "AnalyticsPredictions",
)



class AnalyticsPlayer(db.TimeStampIntegerMixin):
    __tablename__ = "analytics_tournament"

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE")
    )
    player_id: Mapped[int] = mapped_column(ForeignKey(Player.id, ondelete="CASCADE"))
    wins: Mapped[int] = mapped_column()
    losses: Mapped[int] = mapped_column()
    shift_one: Mapped[int | None] = mapped_column(nullable=True)
    shift_two: Mapped[int | None] = mapped_column(nullable=True)
    shift: Mapped[int | None] = mapped_column(nullable=True)

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()


class AnalyticsAlgorithm(db.TimeStampIntegerMixin):
    __tablename__ = "analytics_algorithms"

    name: Mapped[str] = mapped_column(primary_key=True)


class AnalyticsShift(db.TimeStampIntegerMixin):
    __tablename__ = "analytics_shifts"

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE")
    )
    algorithm_id: Mapped[int] = mapped_column(ForeignKey(AnalyticsAlgorithm.id, ondelete="CASCADE"))
    player_id: Mapped[int] = mapped_column(ForeignKey(Player.id, ondelete="CASCADE"))
    shift: Mapped[float] = mapped_column()

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()


class AnalyticsPredictions(db.TimeStampIntegerMixin):
    __tablename__ = "analytics_predictions"


    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE")
    )
    algorithm_id: Mapped[int] = mapped_column(ForeignKey(AnalyticsAlgorithm.id, ondelete="CASCADE"))
    team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    predicted_place: Mapped[int] = mapped_column()
