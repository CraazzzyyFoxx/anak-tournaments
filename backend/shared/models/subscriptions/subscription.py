"""Persisted subscription entitlements and per-workspace provider config.

Verdicts are persisted, not Redis-only, for three reasons: admin list views must
render hundreds of verdicts without a live provider call each (Discord rate-limits
per guild, so a fan-out serializes behind one bucket); admission decisions need an
audit trail; and this mirrors how ``overwatch_rank.battle_tag_state`` backs
``resolve_profiles_open``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db, enums

__all__ = (
    "SUBSCRIPTIONS_SCHEMA",
    "SubscriptionCheckLog",
    "SubscriptionEntitlement",
    "SubscriptionProviderConfig",
)

SUBSCRIPTIONS_SCHEMA = "subscriptions"


class SubscriptionProviderConfig(db.TimeStampIntegerMixin):
    """How one workspace verifies subscriptions with one provider.

    ``config_json`` is provider-shaped:

    - ``discord_role``:   ``{guild_id, role_tiers: [{role_id, tier_rank, tier_label}]}``
    - ``challenge_code``: ``{codes: [{code_sha256, tier_rank, tier_label, expires_at}]}``
    - ``twitch_helix``:   ``{broadcaster_login, broadcaster_id}``

    Challenge codes are stored as SHA-256 digests only -- never plaintext, the same
    discipline ``OAuthService.StatePayload`` applies to ``csrf``/``guard_hash``.

    ``enabled`` defaults to ``false`` so creating a config never silently starts
    enforcing a requirement.
    """

    __tablename__ = "provider_config"
    __table_args__ = (
        UniqueConstraint("workspace_id", "provider", name="uq_subscription_config_workspace_provider"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean(), nullable=False, server_default="false", default=False)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, server_default="{}", default=dict)

    def __repr__(self) -> str:
        return f"<SubscriptionProviderConfig id={self.id} workspace_id={self.workspace_id} provider={self.provider}>"


class SubscriptionEntitlement(db.TimeStampIntegerMixin):
    """Last-known subscription verdict for one (workspace, user, provider).

    ``state`` is the tri-state contract from ``shared.subscriptions``:
    ``active`` / ``inactive`` / ``unknown``, where ``unknown`` fails open. It
    defaults to ``unknown`` so a row that exists but was never resolved cannot
    accidentally refuse anybody.

    ``tier_rank`` is nullable: a provider can prove a subscription without proving
    its level (a base-level challenge code), which is read as level 1.
    """

    __tablename__ = "entitlement"
    __table_args__ = (
        UniqueConstraint("workspace_id", "auth_user_id", "provider", name="uq_subscription_entitlement_scope"),
        Index("ix_subscription_entitlement_workspace_provider", "workspace_id", "provider"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspace.id", ondelete="CASCADE"), index=True)
    auth_user_id: Mapped[int] = mapped_column(ForeignKey("auth.user.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)

    state: Mapped[str] = mapped_column(String(16), nullable=False, server_default="unknown", default="unknown")
    tier_rank: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    tier_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # `DateTime` imported straight from sqlalchemy (as tenancy/workspace.py does)
    # rather than reached through `db.`: `shared.core.db` does not re-export it in
    # `__all__`, so `db.DateTime` is not mypy-legal under --strict.
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    evidence_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    def __repr__(self) -> str:
        return (
            f"<SubscriptionEntitlement id={self.id} auth_user_id={self.auth_user_id} "
            f"provider={self.provider} state={self.state} tier_rank={self.tier_rank}>"
        )


class SubscriptionCheckLog(db.TimeStampIntegerMixin):
    """Append-only log of subscription check attempts — the collection history.

    ``subscriptions.entitlement`` is a single mutable row per (workspace, user,
    provider): every check overwrites the previous verdict in place, so it can
    answer "are they subscribed now?" but never "since when?" or "did this ever
    flap?". This table is the missing time series, and it is deliberately the
    mirror of ``overwatch_rank.fetch_log``: one row per *live* provider
    resolution (cache hits and code-only refusals are not attempts, exactly as
    the rank log skips dedup/cooldown hits), ``created_at`` from the mixin is the
    completion time, and nothing is ever updated.

    ``auth_user_id`` is ``SET NULL`` rather than ``CASCADE`` — unlike the
    entitlement it guards, the history of a deleted account is still the history
    of the collector.
    """

    __tablename__ = "check_log"
    __table_args__ = (
        Index("ix_subscription_check_log_created_at", "created_at"),
        Index("ix_subscription_check_log_state_created", "state", "created_at"),
        # Powers the per-player timeline in the admin detail view.
        Index("ix_subscription_check_log_user_created", "auth_user_id", "created_at"),
        {"schema": SUBSCRIPTIONS_SCHEMA},
    )

    workspace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspace.id", ondelete="SET NULL"), nullable=True, index=True
    )
    auth_user_id: Mapped[int | None] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)

    state: Mapped[str] = mapped_column(String(16), nullable=False)  # enums.SubscriptionCheckState
    tier_rank: Mapped[int | None] = mapped_column(Integer(), nullable=True)
    tier_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    #: What triggered the check — enums.SubscriptionCollectionSource.
    source: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=enums.SubscriptionCollectionSource.scheduled.value
    )
    #: How it was proven — the verdict's own source (discord_role / twitch_helix /
    #: challenge_code / resolver). Distinct from ``source``, which is the trigger.
    mechanism: Mapped[str | None] = mapped_column(String(32), nullable=True)
    #: Verdict evidence reason ("not_subscribed", "missing_scope", …).
    reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text(), nullable=True)

    def __repr__(self) -> str:
        return (
            f"<SubscriptionCheckLog id={self.id} auth_user_id={self.auth_user_id} "
            f"provider={self.provider} state={self.state} source={self.source}>"
        )
