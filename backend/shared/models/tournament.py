import typing
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.workspace import Workspace

if typing.TYPE_CHECKING:
    from shared.models.standings import Standing


__all__ = (
    "Tournament",
    "TournamentGroup",
)


class Tournament(db.TimeStampIntegerMixin):
    __tablename__ = "tournament"
    __table_args__ = ({"schema": "tournament"},)

    workspace_id: Mapped[int] = mapped_column(
        ForeignKey(Workspace.id, ondelete="CASCADE"), index=True
    )
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
    division_grid_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    workspace: Mapped[Workspace] = relationship()
    groups: Mapped[list["TournamentGroup"]] = relationship(uselist=True, passive_deletes=True)
    standings: Mapped[list["Standing"]] = relationship(uselist=True)


class TournamentGroup(db.TimeStampIntegerMixin):
    __tablename__ = "group"
    __table_args__ = ({"schema": "tournament"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey("tournament.tournament.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String())
    description: Mapped[str | None] = mapped_column(String(), nullable=True)
    is_groups: Mapped[bool] = mapped_column(Boolean(), default=False)
    challonge_id: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    challonge_slug: Mapped[str | None] = mapped_column(String(), nullable=True)

    tournament: Mapped[Tournament] = relationship(back_populates="groups")
