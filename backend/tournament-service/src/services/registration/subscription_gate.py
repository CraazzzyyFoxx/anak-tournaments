"""Subscription admission gates.

One rule, two possible gates, and the tournament chooses how early it bites via
``registration_form.subscription_stage`` (``enums.SubscriptionEnforcementStage``):

- **Check-in** always enforces once ``require_subscription`` is on, and blocks on
  any confirmed refusal. Every proof path is on screen by then, so nothing is
  outstanding. This is the default and the only stage most tournaments want: a
  roster is built at check-in, so that is where the answer matters.
- **Registration submit** enforces ONLY when the stage is ``registration``, and
  even then blocks only what is *automatically* provable. A provider the patron
  can still satisfy by pasting a challenge code is deferred (see
  ``evaluate_requirement``'s ``deferred_providers``), because the phrase field is
  only offered at check-in — refusing someone one paste away from admission would
  be a lie about their standing.

The stage is ordered, not a set: ``registration`` implies check-in too, so there
is no way to configure "refuse sign-up but admit at check-in".

Both gates fail OPEN on an undetermined verdict, exactly like
``require_open_profile``: a provider outage must never un-admit a subscriber.

Every composition subtlety lives in ``shared.services.subscriptions.requirement`` (Kleene
three-valued logic). This module only decides *when* to ask and *what to say*.
"""

from __future__ import annotations

from typing import Any, Protocol

from shared.core.enums import SubscriptionCollectionSource, SubscriptionEnforcementStage
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.social import SocialProvider
from shared.services.subscriptions import (
    Outcome,
    SubscriptionRequirement,
    SubscriptionVerdict,
    evaluate_requirement,
)

__all__ = (
    "assert_subscription_allows_check_in",
    "assert_subscription_allows_registration",
    "describe_requirement",
    "enforces_at_registration",
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


def enforces_at_registration(form: Any | None) -> bool:
    """Whether this form's requirement blocks at SIGN-UP, not just at check-in.

    Reads the stage defensively (``getattr`` with the default) for the same reason
    the rest of this module does: the gates are handed duck-typed form objects --
    the ORM row in production, a stub in the unit tests -- and a form that predates
    the column must behave like the default rather than raise mid-admission.

    Anything unrecognised means check-in. An unknown stage is a config or migration
    error, and the safe reading of one is the LOOSER gate: a typo must not start
    refusing sign-ups nobody asked it to refuse.
    """
    stage = getattr(form, "subscription_stage", None) or SubscriptionEnforcementStage.check_in
    return str(stage) == SubscriptionEnforcementStage.registration


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
    """Raise 400 iff the form enforces at sign-up AND the refusal is one the patron
    cannot change on this screen.

    Opt-in per tournament (``subscription_stage == registration``). The default is
    check-in, on the argument that won: a roster is built at check-in, so refusing a
    sign-up weeks earlier over a subscription the player can still buy converts a
    soft requirement into a hard deadline nobody set. An organizer who does want the
    early cut -- to keep the sign-up list itself subscriber-only -- says so on the form.

    When it IS enabled, only the automatically-decided part refuses: what genuinely
    cannot be decided here is a code that has not been offered yet, and that, and
    only that, is deferred. Undetermined still fails open, so a provider outage
    during open signups locks nobody out.

    Returning early costs nothing: the stage is a plain attribute read, so a
    check-in-only tournament never touches the DB or a provider on this path.
    """
    if not enforces_at_registration(form):
        return

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
