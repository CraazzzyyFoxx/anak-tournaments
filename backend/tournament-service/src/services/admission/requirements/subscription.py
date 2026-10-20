"""Translate the composed subscription answer into the admission vocabulary.

``shared/services/subscriptions`` owns WHETHER the rule is satisfied (Kleene
composition, tiers, ``any``/``all``); this module only maps that answer to a
:class:`RequirementState` plus reasons. No composition logic here: a second
Kleene implementation is how ``any[refused, unknown]`` diverges between readers.

Only ``REFUSED`` blocks. Everything else -- including an unknown composed value
-- resolves to ``undetermined`` and fails open.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Final

from shared.services.subscriptions import Outcome, SubscriptionState, SubscriptionVerdict
from src.services.admission.config import AdmissionConfig
from src.services.admission.reasons import reason
from src.services.admission.signals import AdmissionSignals, SubscriptionSignal
from src.services.admission.types import AdmissionStage, RequirementState, RequirementVerdict

__all__ = ("KEY", "build_subscription_signal", "eval_subscription", "serialize_verdicts")

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


def serialize_verdicts(
    verdicts: Mapping[str, SubscriptionVerdict],
) -> dict[str, dict[str, Any]]:
    """Public projection of the per-provider verdicts.

    Deliberately narrow: ``evidence`` can hold guild ids and role ids, which are
    internal. Only ``reason`` is exposed, because the UI branches on it to pick a
    call to action ("link Discord" vs "reconnect Twitch").
    """
    return {
        provider: {
            "state": verdict.state,
            "tier_rank": verdict.tier_rank,
            "tier_label": verdict.tier_label,
            "reason": verdict.evidence.get("reason"),
        }
        for provider, verdict in verdicts.items()
    }


def build_subscription_signal(
    outcome: Outcome,
    verdicts: Mapping[str, SubscriptionVerdict],
) -> SubscriptionSignal:
    """Pack an already-composed outcome and its per-provider detail into a signal.

    ``reasons`` has one entry per non-``active`` provider (``subject`` = provider),
    in sorted order so an aggregate does not reshuffle between requests. Under
    ``mode="any"`` two unresolved providers yield two reasons.

    A verdict with no ``evidence["reason"]`` (a provider bug) still yields an
    ``"unknown"``/``system`` reason rather than an empty list that reads as "no
    problem here".
    """
    return SubscriptionSignal(
        outcome=outcome.value,
        reasons=tuple(
            reason(verdicts[provider].evidence.get("reason"), subject=provider)
            for provider in sorted(verdicts)
            if verdicts[provider].state != SubscriptionState.ACTIVE
        ),
        providers=serialize_verdicts(verdicts),
    )


def eval_subscription(
    config: AdmissionConfig,
    signals: AdmissionSignals,
    stage: AdmissionStage,
) -> RequirementVerdict:
    """Map one registration's subscription signal to its verdict.

    ``signals.subscription is None`` means the resolver never asked (requirement
    off, or no linked site user): ``undetermined``, never "not subscribed".

    An unrecognised outcome lands on ``undetermined`` via the ``_STATES`` default
    rather than raising, so a new ``Outcome`` member cannot turn check-in into a
    mass refusal.

    Uses the ``stage`` argument, never ``config.subscription_stage``: the registry
    is the single reader of that column.
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
