"""Subscription admission gates.

Two gates, one rule, different amounts of certainty available:

- **Registration submit** blocks only what is *automatically* provable. A provider
  the patron can still satisfy by pasting a challenge code is deferred (see
  ``evaluate_requirement``'s ``deferred_providers``), because the phrase field is
  only offered at check-in — refusing someone one paste away from admission would
  be a lie about their standing.
- **Check-in** blocks on any confirmed refusal. Every proof path is on screen by
  then, so nothing is outstanding.

Both fail OPEN on an undetermined verdict, exactly like ``require_open_profile``:
a provider outage must never un-admit a subscriber.

Every composition subtlety lives in ``shared.subscriptions.requirement`` (Kleene
three-valued logic). This module only decides *when* to ask and *what to say*.
"""

from __future__ import annotations

from typing import Any, Protocol

from shared.core.enums import SubscriptionCollectionSource
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SocialProvider
from shared.subscriptions import (
    Outcome,
    SubscriptionRequirement,
    SubscriptionVerdict,
    evaluate_requirement,
)

__all__ = (
    "assert_subscription_allows_check_in",
    "assert_subscription_allows_registration",
    "describe_requirement",
)

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
        source: str = SubscriptionCollectionSource.scheduled,
    ) -> dict[int, tuple[Outcome, dict[str, SubscriptionVerdict]]]: ...

    async def accepted_code_providers(self, *, workspace_id: int, providers: Any) -> set[str]: ...

    async def load_requirement(self, *, workspace_id: int) -> SubscriptionRequirement | None: ...


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


async def _enforceable_requirement(form: Any | None, resolver: RequirementEvaluator) -> SubscriptionRequirement | None:
    """The rule to enforce, or ``None`` when there is nothing to enforce.

    The toggle is the tournament's decision and lives on the form; the rule itself is
    the workspace's and is fetched through the resolver, which also owns the parse and
    its fail-open behaviour (a malformed row must not refuse every patron mid-tournament).
    """
    if form is None or not getattr(form, "require_subscription", False):
        return None
    return await resolver.load_requirement(workspace_id=form.workspace_id)


async def assert_subscription_allows_check_in(
    *,
    form: Any | None,
    auth_user_id: int,
    resolver: RequirementEvaluator,
) -> None:
    """Raise 400 iff the composed requirement is a CONFIRMED refusal."""
    requirement = await _enforceable_requirement(form, resolver)
    if requirement is None:
        return

    outcomes = await resolver.evaluate(
        workspace_id=form.workspace_id,
        auth_user_ids=[auth_user_id],
        requirement=requirement,
        # Check-in is exactly the moment a stale `active` must not be trusted, and
        # it is one user rather than a list, so the extra provider call is cheap.
        force_refresh=True,
        source=SubscriptionCollectionSource.check_in,
    )
    outcome, _verdicts = outcomes[auth_user_id]
    if outcome.blocks_admission:
        raise HTTPException(
            status_code=400,
            detail=f"Для чек-ина нужна активная подписка: {describe_requirement(requirement)}.",
        )


async def assert_subscription_allows_registration(
    *,
    form: Any | None,
    auth_user_id: int,
    resolver: RequirementEvaluator,
) -> None:
    """Raise 400 iff the requirement is refused by a path the patron cannot change here.

    Signing up used to be ungated on the argument that a provider outage during
    open signups must not lock anybody out. That argument only ever covered the
    *undetermined* verdict, which still passes; it never justified admitting a
    patron the provider positively answered "no" about, only to refuse them at
    check-in once the roster is being built. What genuinely cannot be decided here
    is a code that has not been offered yet — that, and only that, is deferred.
    """
    requirement = await _enforceable_requirement(form, resolver)
    if requirement is None:
        return

    outcomes = await resolver.evaluate(
        workspace_id=form.workspace_id,
        auth_user_ids=[auth_user_id],
        requirement=requirement,
        # A blocking decision on one user, once per tournament: worth a live look
        # rather than refusing a patron who subscribed minutes ago.
        force_refresh=True,
        source=SubscriptionCollectionSource.registration,
    )
    outcome, verdicts = outcomes[auth_user_id]
    # Deferring can only ever weaken a refusal, so a non-blocking outcome needs no
    # second question — and the code-config read is skipped on the happy path.
    if not outcome.blocks_admission:
        return

    deferred = await resolver.accepted_code_providers(workspace_id=form.workspace_id, providers=requirement.providers)
    if evaluate_requirement(requirement, verdicts, deferred_providers=deferred).blocks_admission:
        raise HTTPException(
            status_code=400,
            detail=f"Для регистрации нужна активная подписка: {describe_requirement(requirement)}.",
        )
