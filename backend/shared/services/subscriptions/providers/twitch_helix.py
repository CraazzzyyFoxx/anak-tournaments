"""Twitch subscription tiers from Helix ``GET /subscriptions/user``.

Unlike Boosty, Twitch has a documented, official endpoint for exactly this
question. Constraints that shape the code:

- Requires the ``user:read:subscriptions`` scope on the **patron's own** user
  access token, and the ``user_id`` argument must match that token's user.
- Only works for broadcasters who are Affiliate or Partner; otherwise Helix
  answers 400, which is an organizer configuration problem and must NOT be read
  as "this patron is not subscribed".
- The scope was added to ``TwitchOAuthProvider`` alongside this module, so every
  connection created before that resolves as ``unknown`` with
  ``evidence.reason == "missing_scope"`` and the UI offers a reconnect.
- Our own ``TWITCH_CLIENT_ID`` is a separate failure from the patron's token: it
  raises ``HelixNotConfigured`` and resolves ``twitch_client_not_configured``,
  because telling a patron to reconnect cannot fix a credential WE never set.

Helix access is injected as a callable, so the whole decision table is testable
without a network or a live OAuth session. Token refresh (401 -> refresh -> retry
once) belongs to the caller that owns the ``OAuthConnection`` row; by the time it
reaches here a 401 that survived a refresh means the scope is genuinely absent.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Protocol

from shared.services.subscriptions.types import (
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
    normalize_twitch_tier,
)

__all__ = (
    "DEFAULT_TTL_SECONDS",
    "HelixForbidden",
    "HelixMissingScope",
    "HelixNotConfigured",
    "HelixNotFound",
    "HelixUnavailable",
    "TwitchHelixResolver",
)

DEFAULT_TTL_SECONDS: Final = 15 * 60


class HelixError(Exception):
    """Base for the outcomes the resolver distinguishes."""


class HelixNotFound(HelixError):
    """404 -- documented "user is not subscribed to this broadcaster"."""


class HelixMissingScope(HelixError):
    """401 that survived a token refresh: the token lacks the new scope."""


class HelixNotConfigured(HelixError):
    """Our own Helix client id is missing, so no request was ever made.

    Never ``HelixMissingScope``: that reason renders as "reconnect Twitch" and
    puts an operator's missing credential on the patron's to-do list.
    """


class HelixForbidden(HelixError):
    """400/403 -- broadcaster is not Affiliate/Partner, or access is refused."""


class HelixUnavailable(HelixError):
    """5xx / timeout / transport failure."""


class SubscriptionChecker(Protocol):
    async def __call__(self, *, broadcaster_id: str, user_id: str) -> dict[str, Any]: ...


CheckSubscription = SubscriptionChecker | Callable[..., Awaitable[dict[str, Any]]]


class TwitchHelixResolver:
    """Resolve one patron's Twitch subscription tier for one broadcaster."""

    source = SubscriptionSource.TWITCH_HELIX

    def __init__(
        self,
        *,
        check_subscription: CheckSubscription,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._check_subscription = check_subscription
        self._ttl_seconds = ttl_seconds

    async def resolve(
        self,
        *,
        config: dict[str, Any] | None,
        twitch_user_id: str | None,
    ) -> SubscriptionVerdict:
        config = config or {}
        broadcaster_id = str(config.get("broadcaster_id") or "").strip()

        if not broadcaster_id:
            return self._verdict(SubscriptionState.UNKNOWN, reason="broadcaster_not_configured")
        if not twitch_user_id:
            return self._verdict(SubscriptionState.UNKNOWN, reason="no_linked_twitch_account")

        try:
            payload = await self._check_subscription(broadcaster_id=broadcaster_id, user_id=str(twitch_user_id))
        except HelixNotFound:
            return self._verdict(SubscriptionState.INACTIVE, reason="not_subscribed")
        except HelixNotConfigured:
            return self._verdict(SubscriptionState.UNKNOWN, reason="twitch_client_not_configured")
        except HelixMissingScope:
            return self._verdict(SubscriptionState.UNKNOWN, reason="missing_scope")
        except HelixForbidden:
            return self._verdict(SubscriptionState.UNKNOWN, reason="broadcaster_not_eligible")
        except HelixUnavailable:
            return self._verdict(SubscriptionState.UNKNOWN, reason="provider_unavailable")

        rows = (payload or {}).get("data") or []
        if not rows:
            return self._verdict(SubscriptionState.INACTIVE, reason="not_subscribed")

        row = rows[0]
        raw_tier = str(row.get("tier") or "")
        # An undocumented tier still proves a subscription. Leaving tier_rank None
        # means "level >= 1" rather than pretending the patron is not subscribed.
        return self._verdict(
            SubscriptionState.ACTIVE,
            tier_rank=normalize_twitch_tier(raw_tier),
            tier_label=_tier_label(raw_tier),
            raw_tier=raw_tier,
            is_gift=bool(row.get("is_gift")),
            broadcaster_id=broadcaster_id,
        )

    def _verdict(
        self,
        state: str,
        *,
        tier_rank: int | None = None,
        tier_label: str | None = None,
        **evidence: Any,
    ) -> SubscriptionVerdict:
        now = datetime.now(UTC)
        return SubscriptionVerdict(
            state=state,  # type: ignore[arg-type]
            tier_rank=tier_rank,
            tier_label=tier_label,
            source=self.source,
            checked_at=now,
            expires_at=now + timedelta(seconds=self._ttl_seconds),
            evidence=dict(evidence),
        )


def _tier_label(raw_tier: str) -> str | None:
    rank = normalize_twitch_tier(raw_tier)
    return f"Tier {rank}" if rank is not None else None
