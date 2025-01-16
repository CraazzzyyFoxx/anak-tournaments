from sqlalchemy import Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src import models
from src.core import db

__all__ = ("Standing",)


class Standing(db.TimeStampIntegerMixin):
    __tablename__ = "standing"

    __table_args__ = (UniqueConstraint("tournament_id", "group_id", "team_id"),)

    tournament_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(models.Tournament.id), index=True
    )
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(models.TournamentGroup.id), index=True
    )
    team_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(models.Team.id), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    overall_position: Mapped[int] = mapped_column(Integer, server_default="0")
    matches: Mapped[int] = mapped_column(Integer)
    win: Mapped[int] = mapped_column(Integer, default=0)
    draw: Mapped[int] = mapped_column(Integer, default=0)
    lose: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[float] = mapped_column(Float)
    buchholz: Mapped[float | None] = mapped_column(Float, nullable=True)
    tb: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tournament: Mapped[models.Tournament] = relationship(back_populates="standings")
    group: Mapped[models.TournamentGroup] = relationship()
    team: Mapped[models.Team] = relationship(back_populates="standings")
