from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db

if TYPE_CHECKING:
    from shared.models.auth_user import AuthUser
    from shared.models.tournament import Tournament
    from shared.models.user import User

__all__ = (
    "BalancerApplication",
    "BalancerBalance",
    "BalancerPlayer",
    "BalancerTeam",
    "BalancerTournamentSheet",
)


class BalancerTournamentSheet(db.TimeStampIntegerMixin):
    __tablename__ = "tournament_sheet"
    __table_args__ = (
        UniqueConstraint("tournament_id", name="uq_balancer_tournament_sheet_tournament"),
        {"schema": "balancer"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournament.id", ondelete="CASCADE"), index=True)
    source_url: Mapped[str] = mapped_column(Text())
    sheet_id: Mapped[str] = mapped_column(String(255))
    gid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    header_row_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    column_mapping_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    role_mapping_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="true", default=True)
    last_synced_at: Mapped[db.DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text(), nullable=True)

    tournament: Mapped["Tournament"] = relationship()
    applications: Mapped[list["BalancerApplication"]] = relationship(back_populates="tournament_sheet")


class BalancerApplication(db.TimeStampIntegerMixin):
    __tablename__ = "application"
    __table_args__ = (
        UniqueConstraint("tournament_id", "battle_tag_normalized", name="uq_balancer_application_tournament_tag"),
        {"schema": "balancer"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournament.id", ondelete="CASCADE"), index=True)
    tournament_sheet_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.tournament_sheet.id", ondelete="CASCADE"),
        index=True,
    )
    battle_tag: Mapped[str] = mapped_column(String(255))
    battle_tag_normalized: Mapped[str] = mapped_column(String(255), index=True)
    smurf_tags_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    twitch_nick: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discord_nick: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stream_pov: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)
    last_tournament_text: Mapped[str | None] = mapped_column(Text(), nullable=True)
    primary_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    additional_roles_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text(), nullable=True)
    raw_row_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    submitted_at: Mapped[db.DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[db.DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="true", default=True)

    tournament: Mapped["Tournament"] = relationship()
    tournament_sheet: Mapped["BalancerTournamentSheet"] = relationship(back_populates="applications")
    player: Mapped["BalancerPlayer | None"] = relationship(back_populates="application", uselist=False)


class BalancerPlayer(db.TimeStampIntegerMixin):
    __tablename__ = "player"
    __table_args__ = (
        UniqueConstraint("application_id", name="uq_balancer_player_application"),
        {"schema": "balancer"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournament.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.application.id", ondelete="CASCADE"),
        index=True,
    )
    battle_tag: Mapped[str] = mapped_column(String(255))
    battle_tag_normalized: Mapped[str] = mapped_column(String(255), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True)
    role_entries_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    is_flex: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)
    primary_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    secondary_roles_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    division_number: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    rank_value: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    is_in_pool: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="true", default=True)
    admin_notes: Mapped[str | None] = mapped_column(Text(), nullable=True)

    tournament: Mapped["Tournament"] = relationship()
    application: Mapped["BalancerApplication"] = relationship(back_populates="player")
    user: Mapped["User | None"] = relationship()


class BalancerBalance(db.TimeStampIntegerMixin):
    __tablename__ = "balance"
    __table_args__ = (
        UniqueConstraint("tournament_id", name="uq_balancer_balance_tournament"),
        {"schema": "balancer"},
    )

    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournament.id", ondelete="CASCADE"), index=True)
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    result_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    saved_by: Mapped[int | None] = mapped_column(ForeignKey("auth_user.id", ondelete="SET NULL"), nullable=True)
    saved_at: Mapped[db.DateTime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    exported_at: Mapped[db.DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    export_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    export_error: Mapped[str | None] = mapped_column(Text(), nullable=True)

    tournament: Mapped["Tournament"] = relationship()
    author: Mapped["AuthUser | None"] = relationship()
    teams: Mapped[list["BalancerTeam"]] = relationship(back_populates="balance")


class BalancerTeam(db.TimeStampIntegerMixin):
    __tablename__ = "team"
    __table_args__ = ({"schema": "balancer"},)

    balance_id: Mapped[int] = mapped_column(ForeignKey("balancer.balance.id", ondelete="CASCADE"), index=True)
    exported_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("team.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255))
    balancer_name: Mapped[str] = mapped_column(String(255))
    captain_battle_tag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avg_sr: Mapped[float] = mapped_column(Float())
    total_sr: Mapped[int] = mapped_column(Integer())
    roster_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")

    balance: Mapped["BalancerBalance"] = relationship(back_populates="teams")
