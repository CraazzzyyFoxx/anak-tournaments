"""Request/response models of the rank domain: public history reads and the admin collection RPCs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

__all__ = (
    "CollectTriggerRequest",
    "CollectTriggerResponse",
    "CollectionStatusRead",
    "CurrentRank",
    "CurrentRanksResponse",
    "FetchLogRead",
    "RankCollectionStats",
    "RankHistoryPoint",
    "RankHistoryResponse",
    "RankSeries",
    "RankStatusCounts",
    "ReenableDisabledRequest",
    "ReenableDisabledResponse",
)


class RankHistoryPoint(BaseModel):
    captured_at: datetime
    rank_value: int | None
    division: str | None
    tier: int | None
    is_ranked: bool
    season: int | None


class RankSeries(BaseModel):
    """One time series for a (battle_tag, role, platform) tuple.

    The frontend pivots a list of these into either grouping: fix a battle tag
    and draw a line per role, or fix a role and draw a line per battle tag.
    """

    social_account_id: int
    battle_tag: str
    role: str
    platform: str
    points: list[RankHistoryPoint]
    current: RankHistoryPoint | None
    peak_rank_value: int | None
    latest_captured_at: datetime | None


class RankHistoryResponse(BaseModel):
    user_id: int | None
    series: list[RankSeries]
    generated_at: datetime


class CurrentRank(BaseModel):
    social_account_id: int
    battle_tag: str
    role: str
    platform: str
    rank_value: int | None
    division: str | None
    tier: int | None
    is_ranked: bool
    season: int | None
    captured_at: datetime


class CurrentRanksResponse(BaseModel):
    user_id: int | None
    ranks: list[CurrentRank]
    generated_at: datetime


class CollectionStatusRead(BaseModel):
    social_account_id: int
    battle_tag: str
    status: str | None = None
    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    consecutive_failures: int = 0
    next_eligible_at: datetime | None = None
    priority_tier: int = 0


class CollectTriggerRequest(BaseModel):
    user_id: int | None = None
    social_account_ids: list[int] | None = None


class CollectTriggerResponse(BaseModel):
    enqueued: int


class ReenableDisabledRequest(BaseModel):
    # Limit to tags that ever produced a snapshot (skip genuinely-dead handles).
    only_previously_succeeded: bool = False


class ReenableDisabledResponse(BaseModel):
    reenabled: int


class RankStatusCounts(BaseModel):
    """Count per RankCollectionStatus. Statuses absent in a source read stay 0.

    ``extra="ignore"`` so an unexpected status string can never break the read.
    """

    model_config = ConfigDict(extra="ignore")

    ok: int = 0
    pending: int = 0
    not_found: int = 0
    private: int = 0
    error: int = 0
    rate_limited: int = 0
    disabled: int = 0


class RankCollectionStats(BaseModel):
    """Aggregated collection health for the admin dashboard."""

    total: int
    never_checked: int
    by_status: RankStatusCounts
    tier0: int
    tier1: int
    tier2: int
    coverage_24h: int
    coverage_7d: int
    last_success_at: datetime | None
    fetch_24h: RankStatusCounts
    fetch_24h_total: int
    error_rate_24h: float
    enabled: bool
    scope: str
    interval_seconds: int
    rate_limit_per_minute: int
    overfast_base_url: str = ""
    """OverFast instance the worker fetches from — named on the dashboard so an
    outage points at a host instead of at "the collector"."""
    overfast_circuit_state: str = "closed"
    """``closed`` / ``half_open`` / ``open``. Open = every tag fetch is being
    refused upstream-side; the collector looks idle but is broken."""
    invalid_battle_tags_24h: int = 0
    """Fetches rejected because the stored handle is not a battletag."""


class FetchLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    social_account_id: int | None
    # Owning player (resolved via the social account) so a log row is clickable
    # through to the player detail view; null when the account was deleted.
    user_id: int | None = None
    battle_tag: str
    status: str
    source: str
    error: str | None
    snapshots_written: int
    created_at: datetime
