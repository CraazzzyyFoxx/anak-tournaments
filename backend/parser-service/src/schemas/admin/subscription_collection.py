"""Admin read/write schemas for subscription collection.

Mirrors ``rank_collection.py``: an ``extra="ignore"`` tally sub-model with all-zero
defaults so an unexpected state string can never 500 the dashboard, ORM-backed
reads via ``from_attributes``, and one ``*Request``/``*Response`` pair per mutation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

__all__ = (
    "SubscriptionCheckLogRead",
    "SubscriptionCollectTriggerRequest",
    "SubscriptionCollectTriggerResponse",
    "SubscriptionCollectionStats",
    "SubscriptionStateCounts",
    "SubscriptionUserCollectionRead",
)


class SubscriptionStateCounts(BaseModel):
    """Count per ``SubscriptionCheckState``. States absent in a source read stay 0.

    ``extra="ignore"`` so an unexpected state string can never break the read.
    """

    model_config = ConfigDict(extra="ignore")

    active: int = 0
    inactive: int = 0
    unknown: int = 0
    error: int = 0


class SubscriptionCollectionStats(BaseModel):
    """Aggregated collection health for the admin dashboard."""

    #: Entitlement rows tracked (one per workspace × user × provider).
    total: int
    #: Distinct players with at least one entitlement row.
    tracked_users: int
    never_checked: int
    by_state: SubscriptionStateCounts
    #: Entitlement rows per provider ("boosty": 120, "twitch": 118).
    by_provider: dict[str, int]
    coverage_24h: int
    coverage_7d: int
    last_success_at: datetime | None
    last_check_at: datetime | None
    checks_24h: SubscriptionStateCounts
    checks_24h_total: int
    error_rate_24h: float
    #: Open tournaments currently enforcing a subscription requirement.
    active_tournaments: int
    enabled: bool
    interval_seconds: int
    batch_size: int


class SubscriptionCheckLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None = None
    auth_user_id: int | None = None
    # Owning player (resolved via auth_user_id) so a log row is clickable through
    # to the player detail view; null when there is no player profile.
    user_id: int | None = None
    user_name: str | None = None
    provider: str
    state: str
    tier_rank: int | None = None
    tier_label: str | None = None
    source: str
    mechanism: str | None = None
    reason: str | None = None
    error: str | None = None
    created_at: datetime


class SubscriptionUserCollectionRead(BaseModel):
    """One (workspace, provider) entitlement for a player."""

    workspace_id: int | None = None
    workspace_name: str | None = None
    provider: str
    state: str
    tier_rank: int | None = None
    tier_label: str | None = None
    source: str | None = None
    checked_at: datetime | None = None
    expires_at: datetime | None = None
    reason: str | None = None


class SubscriptionCollectTriggerRequest(BaseModel):
    #: Domain ``players.user`` id. Omitted = sweep every active tournament.
    user_id: int | None = None
    #: Restrict to these providers; omitted = every provider the player's
    #: tournaments actually require.
    providers: list[str] | None = None


class SubscriptionCollectTriggerResponse(BaseModel):
    checked: int
