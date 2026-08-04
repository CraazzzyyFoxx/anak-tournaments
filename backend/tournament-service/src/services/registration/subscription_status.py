"""The caller's own subscription standing, plus redemption rate limiting.

Feeds the registration form: one call returns the composed outcome, a
human-readable rule, and a per-provider verdict so the form can render a chip on
each account row and a summary line above them. Without the summary line an
``any`` requirement reads as two independent failures.

Never forces a provider refresh -- the form polls this on render. Only check-in
forces a fresh look, and only for the one acting user.
"""

from __future__ import annotations

from typing import Any, Protocol

import redis.asyncio as aioredis
from loguru import logger
from redis.exceptions import RedisError

from shared.core.errors import BaseAPIException as HTTPException
from shared.subscriptions import Outcome, SubscriptionRequirement, SubscriptionVerdict, parse_requirement
from src.schemas.registration import (
    SubscriptionProviderVerdictRead,
    SubscriptionStatusRead,
)
from src.services.registration.subscription_gate import describe_requirement

__all__ = (
    "REDEEM_ATTEMPT_LIMIT",
    "REDEEM_WINDOW_SECONDS",
    "assert_redeem_attempt_allowed",
    "subscription_status_for_user",
)

# Defence in depth: a challenge code is long enough not to be guessable, but the
# endpoint is still an oracle, so cap the attempts.
REDEEM_ATTEMPT_LIMIT = 10
REDEEM_WINDOW_SECONDS = 600


class RequirementEvaluator(Protocol):
    async def evaluate(
        self,
        *,
        workspace_id: int,
        auth_user_ids: Any,
        requirement: SubscriptionRequirement,
        force_refresh: bool = False,
    ) -> dict[int, tuple[Outcome, dict[str, SubscriptionVerdict]]]: ...

    async def accepted_code_providers(self, *, workspace_id: int, providers: Any) -> set[str]: ...


async def subscription_status_for_user(
    *,
    form: Any | None,
    auth_user_id: int,
    resolver: RequirementEvaluator,
) -> SubscriptionStatusRead:
    if form is None or not getattr(form, "require_subscription", False):
        return SubscriptionStatusRead(required=False)

    try:
        requirement = parse_requirement(getattr(form, "subscription_requirement_json", None))
    except ValueError:
        # Malformed config is rejected on save; reporting "not required" beats
        # surfacing a 500 on the registration form.
        return SubscriptionStatusRead(required=False)

    if not requirement.requirements:
        return SubscriptionStatusRead(required=False)

    outcomes = await resolver.evaluate(
        workspace_id=form.workspace_id,
        auth_user_ids=[auth_user_id],
        requirement=requirement,
        force_refresh=False,
    )
    outcome, verdicts = outcomes[auth_user_id]
    # Which providers will actually take a code right now. Asked for separately
    # because `reason` cannot express it: under the permissive method an unlinked
    # patron reads `no_linked_discord_account`, yet a code would satisfy them too.
    code_providers = await resolver.accepted_code_providers(
        workspace_id=form.workspace_id, providers=requirement.providers
    )
    return SubscriptionStatusRead(
        required=True,
        mode=requirement.mode,
        outcome=outcome.value,
        rule=describe_requirement(requirement),
        verdicts={
            provider: SubscriptionProviderVerdictRead(
                state=verdict.state,
                tier_rank=verdict.tier_rank,
                tier_label=verdict.tier_label,
                reason=verdict.evidence.get("reason"),
                code_accepted=provider in code_providers,
            )
            for provider, verdict in verdicts.items()
        },
    )


async def assert_redeem_attempt_allowed(
    *,
    workspace_id: int,
    auth_user_id: int,
    redis: aioredis.Redis | None = None,
) -> None:
    """Raise 429 once a user exceeds ``REDEEM_ATTEMPT_LIMIT`` in the window.

    Fails OPEN when Redis is unavailable: a code long enough not to be guessable
    makes the limiter defence in depth, and blocking legitimate redemption during
    a Redis blip is the worse outcome. The blip is logged so it is not silent.
    """
    client = redis or _client()
    if client is None:
        return

    key = f"subs:redeem:{workspace_id}:{auth_user_id}"
    try:
        attempts = await client.incr(key)
        if attempts == 1:
            await client.expire(key, REDEEM_WINDOW_SECONDS)
    except RedisError as exc:
        logger.warning(f"redeem rate limit unavailable, allowing attempt: {exc}")
        return

    if attempts > REDEEM_ATTEMPT_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Слишком много попыток. Попробуйте позже.",
        )


_redis_client: aioredis.Redis | None = None


def _client() -> aioredis.Redis | None:
    global _redis_client
    if _redis_client is None:
        from src.core.config import settings

        try:
            _redis_client = aioredis.Redis.from_url(str(settings.redis_url), decode_responses=True)
        except Exception as exc:  # pragma: no cover - configuration failure
            logger.warning(f"redeem rate limit disabled, redis unavailable: {exc}")
            return None
    return _redis_client
