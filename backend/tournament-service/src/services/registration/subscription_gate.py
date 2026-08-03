"""Subscription admission gate for check-in.

The ONLY place a subscription requirement is enforced. Registration submission is
never gated: a provider outage during open signups would lock people out of
signing up, which is strictly worse than admitting someone who later turns out
not to be subscribed.

Every composition subtlety lives in ``shared.subscriptions.requirement`` (Kleene
three-valued logic). This module only decides *when* to ask and *what to say*.
"""

from __future__ import annotations

from typing import Any, Protocol

from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SocialProvider
from shared.subscriptions import Outcome, SubscriptionRequirement, parse_requirement

__all__ = ("assert_subscription_allows_check_in", "describe_requirement")

# Display names for the refusal message. Falls back to the raw provider key so a
# provider added later is still named, just less prettily.
_PROVIDER_LABELS = {
    SocialProvider.BOOSTY: "Boosty",
    SocialProvider.TWITCH: "Twitch",
}


class RequirementEvaluator(Protocol):
    async def evaluate(
        self,
        *,
        workspace_id: int,
        auth_user_ids: Any,
        requirement: SubscriptionRequirement,
        force_refresh: bool = False,
    ) -> dict[int, tuple[Outcome, Any]]: ...


def describe_requirement(requirement: SubscriptionRequirement) -> str:
    """Human-readable rule, e.g. ``Boosty уровень 2 или Twitch``.

    The message must name the ACTUAL rule: under ``any`` a patron who satisfies
    one of two providers is admitted, so a generic "subscription required" would
    leave a refused patron unable to tell which side to fix.
    """
    parts = []
    for req in requirement.requirements:
        label = _PROVIDER_LABELS.get(req.provider, req.provider)
        # A threshold of 1 is "any paid tier" — spelling it out reads like a
        # restriction that is not there.
        parts.append(f"{label} уровень {req.min_tier_rank}" if req.min_tier_rank > 1 else label)
    conjunction = " или " if requirement.mode == "any" else " и "
    return conjunction.join(parts)


async def assert_subscription_allows_check_in(
    *,
    form: Any | None,
    auth_user_id: int,
    resolver: RequirementEvaluator,
) -> None:
    """Raise 400 iff the composed requirement is a CONFIRMED refusal.

    Mirrors the ``require_open_profile`` gate: an undetermined verdict passes.
    """
    if form is None or not getattr(form, "require_subscription", False):
        return

    try:
        requirement = parse_requirement(getattr(form, "subscription_requirement_json", None))
    except ValueError:
        # A malformed `mode` is rejected when the form is saved. If one reached the
        # database anyway, refusing every patron mid-tournament is the worse
        # failure mode, so fail open here too.
        return

    if not requirement.requirements:
        return

    outcomes = await resolver.evaluate(
        workspace_id=form.workspace_id,
        auth_user_ids=[auth_user_id],
        requirement=requirement,
        # Check-in is exactly the moment a stale `active` must not be trusted, and
        # it is one user rather than a list, so the extra provider call is cheap.
        force_refresh=True,
    )
    outcome, _verdicts = outcomes[auth_user_id]
    if outcome.blocks_check_in:
        raise HTTPException(
            status_code=400,
            detail=f"Для чек-ина нужна активная подписка: {describe_requirement(requirement)}.",
        )
