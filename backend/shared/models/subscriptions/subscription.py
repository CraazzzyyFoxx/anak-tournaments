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
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from shared.core import db

__all__ = ("SUBSCRIPTIONS_SCHEMA", "SubscriptionEntitlement", "SubscriptionProviderConfig")

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
