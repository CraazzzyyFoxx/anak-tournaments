import typing

from sqlalchemy import String, ForeignKey, Integer, Float, Boolean, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core import db, enums
from src.models.tournament import Tournament, TournamentGroup
from src.models.team import Team


if typing.TYPE_CHECKING:
    from src.models.match import Match

__all__ = ("Encounter",)


class Encounter(db.TimeStampIntegerMixin):
    __tablename__ = "encounter"

    name: Mapped[str] = mapped_column(String())
    home_team_id: Mapped[int | None] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), nullable=True, index=True
    )
    away_team_id: Mapped[int | None] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), nullable=True, index=True
    )
    home_score: Mapped[int] = mapped_column(Integer())
    away_score: Mapped[int] = mapped_column(Integer())

    round: Mapped[int] = mapped_column(Integer(), index=True)
    closeness: Mapped[float | None] = mapped_column(Float(), nullable=True)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    tournament_group_id: Mapped[int | None] = mapped_column(
        ForeignKey(TournamentGroup.id, ondelete="CASCADE"), nullable=True
    )

    challonge_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    status: Mapped[enums.EncounterStatus] = mapped_column(
        Enum(enums.EncounterStatus), default=enums.EncounterStatus.OPEN
    )
    has_logs: Mapped[bool] = mapped_column(Boolean(), default=False)

    tournament_group: Mapped[TournamentGroup] = relationship()
    tournament: Mapped[Tournament] = relationship()
    home_team: Mapped["Team"] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped["Team"] = relationship(foreign_keys=[away_team_id])
    matches: Mapped[list["Match"]] = relationship()
