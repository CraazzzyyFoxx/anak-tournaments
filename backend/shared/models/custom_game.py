from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("CustomGame", "CustomGamePlayer")


class CustomGame(db.TimeStampIntegerMixin):
    """Workspace pickup game. No tournament_id, no BalancerBalance."""

    __tablename__ = "custom_game"
    __table_args__ = ({"schema": "balancer"},)

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    host_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    outcome_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class CustomGamePlayer(db.TimeStampIntegerMixin):
    """Roster row. rank_value is a per-game override applied to every role.

    ``is_active`` is the bench switch: a benched row keeps its ranks, roles and
    pool membership but is skipped by :meth:`CustomGameService.balance`, so a
    host can drop a late player without losing their setup. ``roles_json`` is an
    ordered list of registration role codes -- position is the balancer's role
    ``priority``, absence means the player does not play that role at all.
    ``None`` means "every role this player has a rank for", the pre-lineup
    default.
    """

    __tablename__ = "custom_game_player"
    __table_args__ = (
        UniqueConstraint("custom_game_id", "workspace_player_id", name="uq_custom_game_player"),
        {"schema": "balancer"},
    )

    custom_game_id: Mapped[int] = mapped_column(ForeignKey("balancer.custom_game.id", ondelete="CASCADE"), index=True)
    workspace_player_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.workspace_player.id", ondelete="CASCADE"), index=True
    )
    rank_value: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    team_index: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=True, server_default="true")
    roles_json: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
