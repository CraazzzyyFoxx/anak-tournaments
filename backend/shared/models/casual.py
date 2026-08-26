from __future__ import annotations

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db, enums

__all__ = ("CasualMatch", "CasualTeam", "CasualPlayer")


class CasualTeam(db.TimeStampIntegerMixin):
    """One side of a casual match (pickup mix, ...). No FK into ``tournament.*``.

    Minted fresh per match and never reused across matches -- the same
    "container scoped above the match, not tied to it" shape ``tournament.team``
    uses relative to ``tournament.encounter``, which is what lets ``CasualMatch``
    reference two of these by id without a chicken-and-egg insert order.
    """

    __tablename__ = "team"
    __table_args__ = ({"schema": "casual"},)

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    players: Mapped[list["CasualPlayer"]] = relationship(back_populates="team", passive_deletes=True)


class CasualPlayer(db.TimeStampIntegerMixin):
    """One roster row, frozen at the moment its match's result was recorded.

    Unlike ``custom_game_player`` (a live, editable lineup row) this is never
    written again after creation -- ``role``/``rank`` are the snapshot at record
    time, so a later rank correction or role change cannot rewrite history.
    """

    __tablename__ = "player"
    __table_args__ = ({"schema": "casual"},)

    team_id: Mapped[int] = mapped_column(ForeignKey("casual.team.id", ondelete="CASCADE"), index=True)
    workspace_member_id: Mapped[int] = mapped_column(
        ForeignKey("workspace_member.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[enums.HeroClass | None] = mapped_column(Enum(enums.HeroClass), nullable=True)
    rank: Mapped[int] = mapped_column(Integer(), nullable=False)

    team: Mapped["CasualTeam"] = relationship(back_populates="players")


class CasualMatch(db.TimeStampIntegerMixin):
    """One played casual match. A single pickup mix can record many of these
    before its host closes it -- ``created_at`` (from the mixin) doubles as
    "when this match was played", since there is no separate start event.
    """

    __tablename__ = "match"
    __table_args__ = ({"schema": "casual"},)

    custom_game_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.custom_game.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("casual.team.id", ondelete="CASCADE"))
    away_team_id: Mapped[int] = mapped_column(ForeignKey("casual.team.id", ondelete="CASCADE"))
    home_score: Mapped[int] = mapped_column(Integer(), nullable=False)
    away_score: Mapped[int] = mapped_column(Integer(), nullable=False)
    # No map-selection UI writes this yet -- the column exists so a future one
    # can, without a schema change.
    map_id: Mapped[int | None] = mapped_column(ForeignKey("overwatch.map.id", ondelete="SET NULL"), nullable=True)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)

    home_team: Mapped["CasualTeam"] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped["CasualTeam"] = relationship(foreign_keys=[away_team_id])
