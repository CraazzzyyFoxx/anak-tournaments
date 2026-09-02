"""Translate the composed subscription answer into the admission vocabulary.

``shared/services/subscriptions`` owns WHETHER the rule is satisfied: the Kleene
composition over providers, the tier comparison, ``any`` versus ``all``. That
layer is correct and stays where it is. This module owns only the translation of
its answer into a :class:`RequirementState` plus reasons, and deliberately holds
no composition logic of its own -- a second Kleene implementation here is exactly
how ``any[refused, unknown]`` ends up blocking in one reader and passing in
another, which is the class of bug this whole layer exists to remove.

One rule survives the translation intact: only ``REFUSED`` blocks. Everything
else -- including a composed value this module has never heard of -- resolves to
``undetermined`` and fails open.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final

from shared.services.admission.config import AdmissionConfig
from shared.services.admission.reasons import reason
from shared.services.admission.signals import AdmissionSignals, SubscriptionSignal
from shared.services.admission.types import AdmissionStage, RequirementState, RequirementVerdict
from shared.services.subscriptions import Outcome, SubscriptionState, SubscriptionVerdict

__all__ = ("KEY", "build_subscription_signal", "eval_subscription")

KEY = "subscription"

#: The composed outcome, translated. Written as a table over ``Outcome`` values
#: rather than an ``if`` chain so that it reads as the mirror of
#: ``Outcome.blocks_admission`` it is: exactly one key maps to ``blocked``.
#: Lookups default to ``undetermined`` -- see :func:`eval_subscription`.
_STATES: Final[dict[str, RequirementState]] = {
    Outcome.SATISFIED.value: RequirementState.satisfied,
    Outcome.REFUSED.value: RequirementState.blocked,
    Outcome.UNDETERMINED.value: RequirementState.undetermined,
}


def build_subscription_signal(
    outcome: Outcome,
    verdicts: Mapping[str, SubscriptionVerdict],
) -> SubscriptionSignal:
    """Pack an already-composed outcome and its per-provider detail into a signal.

    ``reasons`` carries one entry per provider that is not ``active``, tied to
    that provider through ``AdmissionReason.subject``. Under ``mode="any"`` two
    unresolved providers genuinely produce TWO reasons: the composed outcome only
    says the rule is unmet, and keeping one provider's reason would hide half of
    why. Providers are walked in sorted order, because an organizer who reloads
    an aggregate must not see the list reshuffle between requests over nothing
    but ``dict`` insertion order.

    A verdict carrying no ``evidence["reason"]`` still yields a reason (code
    ``"unknown"``, actor ``system``). ``SubscriptionVerdict`` says in its own
    docstring that such a verdict is a provider bug; dropping it would turn the
    bug into an empty reason list, which reads as "no problem here".

    ``providers`` reproduces the ``serialize_verdicts`` projection from
    ``tournament-service`` instead of importing it: ``shared`` must not depend on
    a service. The two MUST stay identical -- the per-provider row chips render
    from whichever one reached them -- and the projection stays narrow on purpose,
    because ``evidence`` also holds guild and role ids that are internal.
    """
    return SubscriptionSignal(
        outcome=outcome.value,
        reasons=tuple(
            reason(verdicts[provider].evidence.get("reason"), subject=provider)
            for provider in sorted(verdicts)
            if verdicts[provider].state != SubscriptionState.ACTIVE
        ),
        providers={
            provider: {
                "state": verdict.state,
                "tier_rank": verdict.tier_rank,
                "tier_label": verdict.tier_label,
                "reason": verdict.evidence.get("reason"),
            }
            for provider, verdict in verdicts.items()
        },
    )


def eval_subscription(
    config: AdmissionConfig,
    signals: AdmissionSignals,
    stage: AdmissionStage,
) -> RequirementVerdict:
    """Map one registration's subscription signal to its verdict.

    ``signals.subscription is None`` means the resolver never asked -- the
    requirement is off for this tournament, or the registration carries no linked
    site user to ask about. That is ``undetermined``, never "not subscribed": the
    distance between "we did not look" and "we looked and found nothing" is the
    distance between admitting a patron and refusing one mid-check-in.

    An unrecognised outcome string lands on ``undetermined`` through the ``_STATES``
    default. Raising instead would let a future ``Outcome`` member, or a signal
    built by a caller this module has not met, turn a live check-in into a mass
    refusal; failing open degrades to "we could not tell", which every consumer
    already handles.

    ``stage`` is the argument, not ``config.subscription_stage``. The registry
    resolved the stage from the config already, and reading that column a second
    time here is how a second source of truth for "when does this bite" starts --
    it had seven readers before this layer existed.
    """
    signal = signals.subscription
    if signal is None:
        return RequirementVerdict(key=KEY, state=RequirementState.undetermined, stage=stage)

    state = _STATES.get(signal.outcome, RequirementState.undetermined)
    return RequirementVerdict(
        key=KEY,
        state=state,
        stage=stage,
        # Reasons ride along on blocked and undetermined alike: an organizer
        # staring at forty undetermined rows needs the actor split to know
        # whether it is forty unlinked accounts or one broken role mapping.
        reasons=() if state is RequirementState.satisfied else signal.reasons,
        detail={"outcome": signal.outcome, "providers": signal.providers},
    )
