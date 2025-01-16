import typing
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db

if typing.TYPE_CHECKING:
    from src.models.standings import Standing


__all__ = (
    "Tournament",
    "TournamentGroup",
)


class Tournament(db.TimeStampIntegerMixin):
    __tablename__ = "tournament"

    number: Mapped[int] = mapped_column(Integer(), nullable=True)
    name: Mapped[str] = mapped_column(String())
    description: Mapped[str | None] = mapped_column(String(), nullable=True)
    challonge_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    challonge_slug: Mapped[str | None] = mapped_column(String(), nullable=True)
    is_league: Mapped[bool] = mapped_column(
        Boolean(), default=False, server_default="false", nullable=False
    )
    is_finished: Mapped[bool] = mapped_column(
        Boolean(), default=False, server_default="false", nullable=False
    )
    start_date: Mapped[datetime | None] = mapped_column(
        db.DateTime(timezone=True), nullable=True
    )
    end_date: Mapped[datetime | None] = mapped_column(
        db.DateTime(timezone=True), nullable=True
    )

    groups: Mapped[list["TournamentGroup"]] = relationship(uselist=True)
    standings: Mapped[list["Standing"]] = relationship(uselist=True)


class TournamentGroup(db.TimeStampIntegerMixin):
    __tablename__ = "tournament_group"

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey("tournament.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String())
    description: Mapped[str | None] = mapped_column(String(), nullable=True)
    is_groups: Mapped[bool] = mapped_column(Boolean(), default=False)
    challonge_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    challonge_slug: Mapped[str | None] = mapped_column(String(), nullable=True)

    tournament: Mapped[Tournament] = relationship(back_populates="groups")
