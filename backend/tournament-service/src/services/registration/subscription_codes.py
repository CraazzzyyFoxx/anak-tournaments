"""Challenge-code redemption.

Fallback for providers with no usable API (Boosty). The author publishes a secret
code inside a post restricted to a subscription level; redeeming it proves the
patron can read that level.

Two properties this deliberately does NOT have, and the reasons:

- It does not prove identity. A code is shareable, so it establishes "has access
  to level >= X", nothing more. Rotate codes per tournament.
- It never downgrades. A patron already on a higher tier (e.g. via Discord roles)
  who redeems a lower-tier code keeps the higher one, and nothing is written.

The plaintext code is never persisted, logged, or echoed -- only its SHA-256
digest is ever compared, the same discipline ``OAuthService.StatePayload`` applies
to ``csrf``/``guard_hash``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from shared.core.errors import BaseAPIException as HTTPException
from shared.services.subscription_entitlements import ProviderConfigRow, StoredEntitlement
from shared.subscriptions import (
    SubscriptionSource,
    SubscriptionState,
    SubscriptionVerdict,
    accepts_code,
    parse_verification_method,
)
from shared.subscriptions.challenge_code import match_code, parse_code_tiers

__all__ = ("redeem_challenge_code",)

# Uniform rejection. The endpoint is a guessing oracle, so the response must not
# reveal whether any codes are configured, whether one expired, or how close a
# guess was.
_REJECTED = "Код не подошёл. Проверьте, что он скопирован из поста целиком."

# Distinct on purpose: this is not a failed guess, it is the wrong mechanism.
_CODES_NOT_ACCEPTED = "Этот турнир проверяет подписку не кодом. Привяжите аккаунт вместо ввода кода."


class _Store(Protocol):
    async def load_configs(self, workspace_id: int, providers: list[str]) -> dict[str, ProviderConfigRow]: ...

    async def load_entitlements(
        self, workspace_id: int, auth_user_ids: list[int], providers: list[str]
    ) -> dict[tuple[int, str], StoredEntitlement]: ...

    async def upsert(
        self, workspace_id: int, auth_user_id: int, provider: str, verdict: SubscriptionVerdict
    ) -> None: ...


async def redeem_challenge_code(
    *,
    store: _Store,
    workspace_id: int,
    auth_user_id: int,
    provider: str,
    submitted_code: str | None,
    now: datetime | None = None,
) -> SubscriptionVerdict:
    """Redeem ``submitted_code``, returning the resulting entitlement.

    Raises 400 with a uniform message on any failure. Writes nothing unless the
    redemption genuinely improves on what the patron already has.
    """
    moment = now or datetime.now(UTC)

    configs = await store.load_configs(workspace_id, [provider])
    config = configs.get(provider)
    if config is None or not config.enabled:
        raise HTTPException(status_code=400, detail=_REJECTED)

    # Not the guessing-oracle message: whether codes are accepted at all is a
    # public property of the tournament (the UI does not even render the input),
    # identical for every submitted code, so saying so plainly leaks nothing — and
    # it beats blaming the patron's copy-paste for the organizer's choice.
    if not accepts_code(parse_verification_method(config.config)):
        raise HTTPException(status_code=400, detail=_CODES_NOT_ACCEPTED)

    tiers = parse_code_tiers(config.config)
    matched = match_code(submitted_code, tiers, now=moment) if tiers else None
    if matched is None:
        raise HTTPException(status_code=400, detail=_REJECTED)

    granted = SubscriptionVerdict(
        state=SubscriptionState.ACTIVE,
        tier_rank=matched.tier_rank,
        tier_label=matched.tier_label or None,
        source=SubscriptionSource.CHALLENGE_CODE,
        checked_at=moment,
        expires_at=matched.expires_at,
        evidence={"reason": "code_redeemed", "tier_rank": matched.tier_rank},
    )

    # Never downgrade: a live entitlement at an equal-or-higher tier wins, and
    # writing nothing keeps its original source and expiry intact.
    existing = (await store.load_entitlements(workspace_id, [auth_user_id], [provider])).get((auth_user_id, provider))
    if _outranks(existing, granted, moment):
        return existing.to_verdict()  # type: ignore[union-attr]

    await store.upsert(workspace_id, auth_user_id, provider, granted)
    return granted


def _outranks(existing: StoredEntitlement | None, granted: SubscriptionVerdict, moment: datetime) -> bool:
    """Whether a stored entitlement already beats what the code would grant."""
    if existing is None or existing.state != SubscriptionState.ACTIVE:
        return False
    if existing.expires_at is not None and existing.expires_at <= moment:
        return False
    # `None` means "subscribed, level unknown", which is level 1 for comparison.
    return (existing.tier_rank or 1) >= (granted.tier_rank or 1)
