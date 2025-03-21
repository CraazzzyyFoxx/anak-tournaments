from sqlalchemy import Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db
from src.models.team import Team
from src.models.tournament import Tournament, TournamentGroup

__all__ = ("Standing",)


class Standing(db.TimeStampIntegerMixin):
    __tablename__ = "standing"

    __table_args__ = (UniqueConstraint("tournament_id", "group_id", "team_id"),)

    tournament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(Tournament.id), index=True
    )
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(TournamentGroup.id), index=True
    )
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey(Team.id), index=True)
    position: Mapped[int] = mapped_column(Integer)
    overall_position: Mapped[int] = mapped_column(Integer, server_default="0")
    matches: Mapped[int] = mapped_column(Integer)
    win: Mapped[int] = mapped_column(Integer, default=0)
    draw: Mapped[int] = mapped_column(Integer, default=0)
    lose: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[float] = mapped_column(Float)
    buchholz: Mapped[float | None] = mapped_column(Float, nullable=True)
    tb: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tournament: Mapped[Tournament] = relationship(back_populates="standings")
    group: Mapped[TournamentGroup] = relationship()
    team: Mapped[Team] = relationship(back_populates="standings")
