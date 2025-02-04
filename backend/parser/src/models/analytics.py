from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db
from src.models.tournament import Tournament
from src.models.team import Player, Team


__all__ = ("TournamentAnalytics",)


class TournamentAnalytics(db.TimeStampIntegerMixin):
    __tablename__ = "analytics"

    player_id: Mapped[int] = mapped_column(ForeignKey(Player.id, ondelete="CASCADE"))
    team_id: Mapped[int] = mapped_column(ForeignKey(Team.id, ondelete="CASCADE"))
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE")
    )
    wins: Mapped[int] = mapped_column()
    losses: Mapped[int] = mapped_column()
    shift_one: Mapped[int | None] = mapped_column(nullable=True)
    shift_two: Mapped[int | None] = mapped_column(nullable=True)
    shift: Mapped[int | None] = mapped_column(nullable=True)
    calculated_shift: Mapped[float] = mapped_column()

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()
    team: Mapped[Team] = relationship()
