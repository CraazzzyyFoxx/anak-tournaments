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
    #: Extra workspace-member user ids who write this mix exactly like the
    #: host (roster, balance, outcomes, settings) -- see
    #: ``CustomGameService.add_co_host``/``remove_co_host``. Never includes
    #: ``host_user_id`` itself; ``None``/empty means no co-hosts.
    co_host_user_ids: Mapped[list[int] | None] = mapped_column(JSONB, nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    outcome_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class CustomGamePlayer(db.TimeStampIntegerMixin):
    """Roster row of a mix, anchored on the workspace member.

    Carries no rank of its own: a correction goes into the host's own layer of
    ``member_rank``, so it survives the game instead of being forgotten with it.

    ``is_active`` is the bench switch: a benched row keeps its roles and pool
    membership but is skipped by :meth:`CustomGameService.balance`, so a host can
    drop a late player without losing their setup. ``roles_json`` is an ordered
    list of registration role codes -- position is the balancer's role
    ``priority``, absence means the player does not play that role at all.
    ``None`` means "every role this player has a rank for", the pre-lineup
    default. ``must_play`` guarantees a seat when the active lineup does not
    divide evenly into full teams: the balancer trims the leftover from the
    optional players first, only reaching into the flagged ones if there are
    more of them than team slots exist.
    """

    __tablename__ = "custom_game_player"
    __table_args__ = (
        UniqueConstraint("custom_game_id", "workspace_member_id", name="uq_custom_game_player_member"),
        {"schema": "balancer"},
    )

    custom_game_id: Mapped[int] = mapped_column(ForeignKey("balancer.custom_game.id", ondelete="CASCADE"), index=True)
    workspace_member_id: Mapped[int] = mapped_column(
        ForeignKey("workspace_member.id", ondelete="CASCADE"), index=True
    )
    team_index: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer(), nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=True, server_default="true")
    must_play: Mapped[bool] = mapped_column(Boolean(), nullable=False, default=False, server_default="false")
    roles_json: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
