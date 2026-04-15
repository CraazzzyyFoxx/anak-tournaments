from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared.core import db
from shared.models.team import Player, Team
from shared.models.tournament import Tournament

if TYPE_CHECKING:
    from shared.models.user import User
    from shared.models.workspace import Workspace

__all__ = (
    "AnalyticsBalancePlayerSnapshot",
    "AnalyticsBalanceSnapshot",
    "AnalyticsPlayer",
    "AnalyticsAlgorithm",
    "AnalyticsPredictions",
    "AnalyticsShift",
)


class AnalyticsPlayer(db.TimeStampIntegerMixin):
    __tablename__ = "tournament"
    __table_args__ = ({"schema": "analytics"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey(Player.id, ondelete="CASCADE"), index=True
    )
    wins: Mapped[int] = mapped_column()
    losses: Mapped[int] = mapped_column()
    shift_one: Mapped[int | None] = mapped_column(nullable=True)
    shift_two: Mapped[int | None] = mapped_column(nullable=True)
    shift: Mapped[int | None] = mapped_column(nullable=True)

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()


class AnalyticsAlgorithm(db.TimeStampIntegerMixin):
    __tablename__ = "algorithms"
    __table_args__ = ({"schema": "analytics"},)

    name: Mapped[str] = mapped_column(String(), unique=True)


class AnalyticsShift(db.TimeStampIntegerMixin):
    __tablename__ = "shifts"
    __table_args__ = ({"schema": "analytics"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    algorithm_id: Mapped[int] = mapped_column(
        ForeignKey(AnalyticsAlgorithm.id, ondelete="CASCADE"), index=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey(Player.id, ondelete="CASCADE"), index=True
    )
    shift: Mapped[float] = mapped_column()
    confidence: Mapped[float] = mapped_column(Float(), nullable=False, server_default="0", default=0.0)
    effective_evidence: Mapped[float] = mapped_column(
        Float(), nullable=False, server_default="0", default=0.0
    )
    sample_tournaments: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)
    sample_matches: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)
    log_coverage: Mapped[float] = mapped_column(Float(), nullable=False, server_default="0", default=0.0)

    tournament: Mapped[Tournament] = relationship()
    player: Mapped[Player] = relationship()


class AnalyticsPredictions(db.TimeStampIntegerMixin):
    __tablename__ = "predictions"
    __table_args__ = ({"schema": "analytics"},)

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    algorithm_id: Mapped[int] = mapped_column(
        ForeignKey(AnalyticsAlgorithm.id, ondelete="CASCADE"), index=True
    )
    team_id: Mapped[int] = mapped_column(
        ForeignKey(Team.id, ondelete="CASCADE"), index=True
    )
    predicted_place: Mapped[int] = mapped_column()


# ---------------------------------------------------------------------------
# Balance quality snapshots (written at balance export time)
# ---------------------------------------------------------------------------


class AnalyticsBalanceSnapshot(db.TimeStampIntegerMixin):
    """Snapshot of a balance result, created when a balance is exported to a tournament."""

    __tablename__ = "balance_snapshot"
    __table_args__ = (
        UniqueConstraint("tournament_id", "balance_id", name="uq_analytics_balance_snapshot"),
        {"schema": "analytics"},
    )

    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    balance_id: Mapped[int] = mapped_column(
        ForeignKey("balancer.balance.id", ondelete="CASCADE"), index=True
    )
    variant_id: Mapped[int | None] = mapped_column(
        ForeignKey("balancer.balance_variant.id", ondelete="SET NULL"), nullable=True
    )
    workspace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspace.id", ondelete="SET NULL"), nullable=True
    )
    algorithm: Mapped[str] = mapped_column(String(32), nullable=False)
    division_scope: Mapped[str | None] = mapped_column(String(32), nullable=True)
    division_grid_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    team_count: Mapped[int] = mapped_column(Integer(), nullable=False)
    player_count: Mapped[int] = mapped_column(Integer(), nullable=False)
    avg_sr_overall: Mapped[float] = mapped_column(Float(), nullable=False)
    sr_std_dev: Mapped[float] = mapped_column(Float(), nullable=False)
    sr_range: Mapped[float] = mapped_column(Float(), nullable=False)
    total_discomfort: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)
    off_role_count: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)
    objective_score: Mapped[float | None] = mapped_column(Float(), nullable=True)

    tournament: Mapped[Tournament] = relationship()
    workspace: Mapped["Workspace | None"] = relationship()
    players: Mapped[list["AnalyticsBalancePlayerSnapshot"]] = relationship(back_populates="snapshot")


class AnalyticsBalancePlayerSnapshot(db.TimeStampIntegerMixin):
    """Per-player snapshot of their balance assignment at export time."""

    __tablename__ = "balance_player_snapshot"
    __table_args__ = ({"schema": "analytics"},)

    balance_snapshot_id: Mapped[int] = mapped_column(
        ForeignKey("analytics.balance_snapshot.id", ondelete="CASCADE"), index=True
    )
    tournament_id: Mapped[int] = mapped_column(
        ForeignKey(Tournament.id, ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey(Team.id, ondelete="SET NULL"), nullable=True
    )
    assigned_role: Mapped[str] = mapped_column(String(16), nullable=False)
    preferred_role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    assigned_rank: Mapped[int] = mapped_column(Integer(), nullable=False)
    discomfort: Mapped[int] = mapped_column(Integer(), nullable=False, server_default="0", default=0)
    division_number: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    is_captain: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)
    was_off_role: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)

    snapshot: Mapped[AnalyticsBalanceSnapshot] = relationship(back_populates="players")
    tournament: Mapped[Tournament] = relationship()
    user: Mapped["User | None"] = relationship()
