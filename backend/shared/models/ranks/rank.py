from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db, enums

__all__ = (
    "RankAccountState",
    "RankFetchLog",
    "UserRankSnapshot",
)

#: One schema for every game's rank telemetry, isolated from player identity; each row names its game in ``discipline``.
RANK_SCHEMA = "rank"


class UserRankSnapshot(db.Base):
    """One observed CHANGE of a game account's rank (``discipline`` names the game).

    Overwatch: one series per (account, role, platform), OverFast ``division``/``tier``. League of Legends: one series
    per (account, ``queue``) — ``solo``/``flex`` — with ``division`` = league-v4 tier, ``tier`` = 1..4 (apex NULL),
    ``lp``/``wins``/``losses``, no role and no platform. Written only when the poll finds something different from the
    series' last row (migration ``rankdedup01``; ``stats-service`` ``changed_ranks``). The first poll of an account
    records every series, unranked ones included, so every later transition -- ranked to unranked too -- has a row to
    be read against. A poll that changes nothing writes nothing; the state row's ``last_success_at`` is what proves
    the account was checked. Native ``division``/``tier`` are always stored; ``rank_value`` is the game's own ladder
    value (Overwatch: the mapped integer compatible with the DivisionGrid/balancer scale). Attached to the domain
    ``players.user`` -- never to ``auth.user``.

    ``db.Base`` rather than ``TimeStampIntegerMixin``: the mixin's ``created_at`` would duplicate ``captured_at``
    while ``updated_at`` stays NULL on every row of an append-only series.
    """

    __tablename__ = "rank_snapshot"
    __table_args__ = (
        Index("ix_rank_snapshot_user_captured", "user_id", "captured_at"),
        Index("ix_rank_snapshot_series_captured", "social_account_id", "role", "platform", "queue", "captured_at"),
        # The "newest ranked snapshot per (account, role, queue)" probe (registration autofill, native reads): one
        # index descent per pair instead of a sort over the whole history. Partial so an account unranked in a
        # series does not walk its history.
        Index(
            "ix_rank_snapshot_latest_ranked",
            "social_account_id",
            "role",
            "queue",
            text("captured_at DESC"),
            postgresql_where=text("rank_value IS NOT NULL AND is_ranked IS TRUE"),
        ),
        {"schema": RANK_SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger(), primary_key=True, sort_order=-1000)
    discipline: Mapped[str] = mapped_column(String(32))
    # Not individually indexed: the composite indexes above cover these columns as their leftmost prefix.
    user_id: Mapped[int] = mapped_column(ForeignKey("players.user.id", ondelete="CASCADE"))
    # The game account's ``players.social_account`` row this rank belongs to.
    social_account_id: Mapped[int] = mapped_column(ForeignKey("players.social_account.id", ondelete="CASCADE"))
    # Denormalized account label ("Name#1234", "Name#TAG") so history survives account deletion.
    handle: Mapped[str] = mapped_column(String(255))

    platform: Mapped[str | None] = mapped_column(String(16), nullable=True)  # OW enums.RankPlatform; LoL NULL
    role: Mapped[str | None] = mapped_column(String(16), nullable=True)  # OW enums.HeroClass.name; LoL NULL
    queue: Mapped[str | None] = mapped_column(String(16), nullable=True)  # LoL "solo" | "flex"; OW NULL

    # Native rank; null when the player is unranked in that series.
    division: Mapped[str | None] = mapped_column(String(32), nullable=True)
    tier: Mapped[int | None] = mapped_column(SmallInteger(), nullable=True)
    season: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    lp: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    wins: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    losses: Mapped[int | None] = mapped_column(Integer(), nullable=True)

    # Ladder integer rank (nullable: native data is kept even if unmapped).
    rank_value: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    mapping_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    is_ranked: Mapped[bool] = mapped_column(Boolean(), server_default="true")

    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=db.func.now(), index=True)
    source: Mapped[str] = mapped_column(String(32), server_default=enums.RankCollectionSource.scheduled.value)


class RankAccountState(db.TimeStampIntegerMixin):
    """Collection bookkeeping for one game account (one row per ``players.social_account``).

    Kept separate from ``players.social_account`` (identity data) because this row is high-churn — updated on every
    poll — and drives scheduling, backoff and prioritization without touching the identity table or its indexes.
    ``external_id`` is the upstream's own id (OverFast "Name-1234", Riot PUUID); ``region`` the LoL platform.
    """

    __tablename__ = "account_state"
    __table_args__ = (
        Index("ix_account_state_due", "discipline", "status", "next_eligible_at", "last_checked_at"),
        Index("ix_account_state_priority", "priority_tier", "last_checked_at"),
        {"schema": RANK_SCHEMA},
    )

    discipline: Mapped[str] = mapped_column(String(32))
    social_account_id: Mapped[int] = mapped_column(
        ForeignKey("players.social_account.id", ondelete="CASCADE"), unique=True
    )
    handle: Mapped[str] = mapped_column(String(255))
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    region: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Not individually indexed: covered by the composite indexes above.
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(String(32), server_default=enums.RankCollectionStatus.pending.value)
    consecutive_failures: Mapped[int] = mapped_column(Integer(), server_default="0")
    next_eligible_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text(), nullable=True)
    # 0 = background sweep (all users); higher = registration-driven priority.
    priority_tier: Mapped[int] = mapped_column(SmallInteger(), server_default="0")


class RankFetchLog(db.TimeStampIntegerMixin):
    """Append-only log of worker fetch attempts — the global task history, per game.

    One row per processed fetch; ``created_at`` (from the mixin) is the completion time. Powers the admin task feed.
    """

    __tablename__ = "fetch_log"
    __table_args__ = (
        Index("ix_fetch_log_created_at", "created_at"),
        Index("ix_fetch_log_status_created", "status", "created_at"),
        {"schema": RANK_SCHEMA},
    )

    discipline: Mapped[str] = mapped_column(String(32))
    social_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.social_account.id", ondelete="SET NULL"), nullable=True
    )
    handle: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32))  # enums.RankCollectionStatus
    source: Mapped[str] = mapped_column(String(32))  # enums.RankCollectionSource
    error: Mapped[str | None] = mapped_column(Text(), nullable=True)
    snapshots_written: Mapped[int] = mapped_column(Integer(), server_default="0")
