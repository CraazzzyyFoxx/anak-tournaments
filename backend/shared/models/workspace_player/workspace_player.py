from __future__ import annotations

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("HostPlayer", "HostPlayerRank", "WorkspacePlayer", "WorkspacePlayerRank")


class WorkspacePlayer(db.TimeStampIntegerMixin):
    """Workspace-scoped player identity. Ghosts have no player_id."""

    __tablename__ = "workspace_player"
    __table_args__ = (
        Index(
            "uq_workspace_player_tag_active",
            "workspace_id",
            "battle_tag_normalized",
            unique=True,
            postgresql_where="battle_tag_normalized IS NOT NULL AND hidden_at IS NULL",
        ),
        Index(
            "uq_workspace_player_player_active",
            "workspace_id",
            "player_id",
            unique=True,
            postgresql_where="player_id IS NOT NULL AND hidden_at IS NULL",
        ),
        {"schema": "balancer"},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    battle_tag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    battle_tag_normalized: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    player_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.user.id", ondelete="SET NULL"), nullable=True
    )
    workspace_member_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspace_member.id", ondelete="SET NULL"), nullable=True
    )
    hidden_at: Mapped[db.DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WorkspacePlayerRank(db.TimeStampIntegerMixin):
    """Per-role rank on a workspace player. Role codes are tank/dps/support."""

    __tablename__ = "workspace_player_rank"
    __table_args__ = (
        UniqueConstraint("workspace_player_id", "role", name="uq_workspace_player_rank"),
        {"schema": "balancer"},
    )

    workspace_player_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.workspace_player.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    rank_value: Mapped[int] = mapped_column(Integer(), nullable=False)


class HostPlayer(db.TimeStampIntegerMixin):
    """Per-host subset of workspace players. Independent of the rank book."""

    __tablename__ = "host_player"
    __table_args__ = (
        UniqueConstraint("workspace_id", "host_user_id", "workspace_player_id", name="uq_host_player"),
        {"schema": "balancer"},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    host_user_id: Mapped[int] = mapped_column(ForeignKey("auth.user.id", ondelete="CASCADE"), index=True)
    workspace_player_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.workspace_player.id", ondelete="CASCADE"), index=True
    )


class HostPlayerRank(db.TimeStampIntegerMixin):
    """Host rank book. Survives pool removal. Does not write canon."""

    __tablename__ = "host_player_rank"
    __table_args__ = (
        UniqueConstraint("host_user_id", "workspace_player_id", "role", name="uq_host_player_rank"),
        {"schema": "balancer"},
    )

    host_user_id: Mapped[int] = mapped_column(ForeignKey("auth.user.id", ondelete="CASCADE"), index=True)
    workspace_player_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.workspace_player.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    rank_value: Mapped[int] = mapped_column(Integer(), nullable=False)
