"""Provider-agnostic subscription entitlement types.

Mirrors the tri-state contract of ``shared.services.profile_visibility``:
``unknown`` means "we could not determine this" and MUST fail open, so a
provider outage is never mistaken for a cancelled subscription.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, Literal, Protocol

__all__ = (
    "ResolveContext",
    "SubscriptionProvider",
    "SubscriptionSource",
    "SubscriptionState",
    "SubscriptionVerdict",
    "meets_min_tier",
    "normalize_twitch_tier",
)


class SubscriptionState:
    ACTIVE: Final = "active"
    INACTIVE: Final = "inactive"
    UNKNOWN: Final = "unknown"


class SubscriptionSource:
    DISCORD_ROLE: Final = "discord_role"
    CHALLENGE_CODE: Final = "challenge_code"
    TWITCH_HELIX: Final = "twitch_helix"


@dataclass(frozen=True, slots=True)
class SubscriptionVerdict:
    """One resolved entitlement.

    ``tier_rank`` is normalized across providers so it can be compared against a
    tournament's ``min_tier_rank``. ``None`` on an ``active`` verdict means the
    provider proved a subscription but not its level — treated as level 1.
    ``tier_label`` is display-only and never compared.

    ``evidence`` is the audit trail persisted to ``entitlement.evidence_json``:
    which role matched, whether a Twitch sub was gifted, and — crucially — WHY a
    verdict is ``unknown``. The UI branches on ``evidence["reason"]`` to show the
    right call to action (link Discord vs reconnect Twitch), so an ``unknown``
    without a reason is a bug, not merely unhelpful.
    """

    state: Literal["active", "inactive", "unknown"]
    tier_rank: int | None
    tier_label: str | None
    source: str
    checked_at: datetime
    expires_at: datetime | None
    evidence: dict[str, Any] = field(default_factory=dict)


class ResolveContext(Protocol):
    """What a provider needs to resolve one user. Deliberately narrow."""

    workspace_id: int
    auth_user_id: int
    config: dict[str, Any]


class SubscriptionProvider(Protocol):
    provider: str

    async def resolve(self, ctx: ResolveContext) -> SubscriptionVerdict: ...


def meets_min_tier(verdict: SubscriptionVerdict, *, min_tier_rank: int) -> bool:
    """Whether ``verdict`` satisfies a ``min_tier_rank`` admission requirement.

    ``unknown`` fails OPEN — identical to the ``require_open_profile`` gate, which
    blocks only on a *confirmed* closed profile.
    """
    if verdict.state == SubscriptionState.UNKNOWN:
        return True
    if verdict.state != SubscriptionState.ACTIVE:
        return False
    return (verdict.tier_rank or 1) >= min_tier_rank


_TWITCH_TIERS: Final[dict[str, int]] = {"1000": 1, "2000": 2, "3000": 3}


def normalize_twitch_tier(raw: str | None) -> int | None:
    """Map Twitch's documented ``tier`` strings to a comparable rank.

    Twitch documents exactly 1000/2000/3000; anything else is unmapped rather
    than guessed.
    """
    return _TWITCH_TIERS.get(raw or "")
