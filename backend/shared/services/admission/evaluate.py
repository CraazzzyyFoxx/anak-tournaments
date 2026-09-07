"""The decision: signals in, one :class:`AdmissionEvaluation` out.

Synchronous, and deliberately *unable* to do I/O. No ``AsyncSession``, no HTTP
client, no resolver import -- the batch contract (one pass over a 200-row list,
because Discord rate-limits per guild and per-registration fan-out makes the
participants page unusable) is a property of this signature rather than a promise
in a comment. ``resolve.py`` pays for every signal once and hands the results
here as plain data.

``requirements`` is a PARAMETER rather than a module-level import of
:data:`registry.REQUIREMENTS`, and the reason is not import hygiene:

- the core's own tests drive it with stub requirements that return a fixed
  verdict, which is what makes it possible to assert the fail-open invariant and
  the stage ordering for *every* :class:`RequirementState` at *every* stage. A
  module global would have tied those assertions to the production evaluators,
  so proving "only ``blocked`` blocks" would have meant building a battle-tag
  state row and a Discord provider verdict first -- and the invariant would then
  only have been checked for the states those fixtures happen to produce;
- ``resolve.py`` passes the production tuple at the single call site, so
  ``registry.py`` stays the only file that changes when a third requirement
  lands.

The ``checked_in`` short-circuit is the whole reason this layer exists (D2).
Requirements are gates on TRANSITIONS, not invariants on state, and
:class:`AdmissionStage` is ordered such that check-in is the last gate of every
requirement. So passing check-in -- through the public gate, or by an organizer
checking the player in by hand -- spends them all. Recomputing them afterwards is
what made the client badge read "not admitted" forever for a player an organizer
had deliberately let in: the admin path was already an override mechanism, broken
only at the point where it was displayed. The blocked requirements are not
hidden, they move to ``overridden``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from shared.services.admission.config import AdmissionConfig
from shared.services.admission.signals import AdmissionSignals
from shared.services.admission.types import (
    AdmissionDecision,
    AdmissionEvaluation,
    AdmissionStage,
    Requirement,
    RequirementState,
    RequirementVerdict,
)

__all__ = ("blocks_at", "evaluate", "stage_reached")

#: Stage order, as a rank rather than a comparison on the enum values.
#:
#: :class:`AdmissionStage` is ordered, not a set, and the values do NOT sort into
#: that order: ``"check_in" < "registration"`` alphabetically, which is exactly
#: backwards. Comparing the members directly would therefore be wrong today and
#: not merely fragile later. Ranks also survive a third stage being inserted
#: between the two without every comparison site having to be re-read.
_STAGE_RANK: Final[dict[AdmissionStage, int]] = {
    AdmissionStage.registration: 0,
    AdmissionStage.check_in: 1,
}


def stage_reached(requirement_stage: AdmissionStage, stage: AdmissionStage) -> bool:
    """Whether a requirement gated at ``requirement_stage`` is due by ``stage``.

    Public because ``resolve.py`` needs the same ordering to decide whether a
    requirement is worth RESOLVING at all, not merely whether it blocks. A
    subscription rule staged at check-in must not cost a forced provider call
    during sign-up, and -- worse than the wasted call -- must not write a check-log
    row attributed to a sign-up decision in a tournament that does not gate
    sign-up. One definition of the order, two questions asked of it.
    """
    return _STAGE_RANK[requirement_stage] <= _STAGE_RANK[stage]


def blocks_at(verdict: RequirementVerdict, stage: AdmissionStage) -> bool:
    """Whether ``verdict`` is a confirmed failure whose gate has already arrived.

    Two independent conditions, and both matter. ``verdict.blocks`` keeps the
    fail-open rule in one place: ``undetermined`` is a provider outage, an
    unlinked account or a collection nobody has run yet, and treating it as a
    refusal would un-admit a paying subscriber during a live check-in.
    :func:`stage_reached` then answers "is this gate due" -- a requirement gated at
    registration bites at both gates because ``registration`` implies
    ``check_in``, while one gated at check-in must stay silent during sign-up.
    """
    return verdict.blocks and stage_reached(verdict.stage, stage)


def _verdict_for(
    requirement: Requirement,
    config: AdmissionConfig,
    signals: AdmissionSignals,
) -> RequirementVerdict:
    """Ask one requirement, or answer ``not_applicable`` without asking it.

    A disabled requirement's evaluator is not called at all. It could not answer
    honestly if it were: the resolver skips signals for requirements this
    tournament switched off, so the evaluator would be reading a ``None`` signal
    and would have to re-derive "switched off" from "nothing was resolved" --
    conflating a disabled requirement with a failed lookup, which is precisely
    the distinction ``not_applicable`` versus ``undetermined`` exists to keep.

    The verdict still carries the requirement's stage, and it still ships in
    ``requirements``: the registrant's progress steps are built by walking that
    tuple, so dropping the disabled entries here would push a
    ``if config.require_x`` branch back into the UI once per requirement.
    """
    stage = requirement.stage(config)
    if not requirement.enabled(config):
        return RequirementVerdict(key=requirement.key, state=RequirementState.not_applicable, stage=stage)
    return requirement.evaluate(config, signals, stage)


def evaluate(
    config: AdmissionConfig,
    signals: AdmissionSignals,
    *,
    stage: AdmissionStage,
    requirements: Sequence[Requirement],
) -> AdmissionEvaluation:
    """Answer "is this registration admitted", at ``stage``, in one structure.

    ``stage`` is the gate being asked about -- an explicit argument at every
    write site, replacing "which checks the handler happens to call, in which
    order" as the encoding of when a requirement bites.
    """
    verdicts = tuple(_verdict_for(requirement, config, signals) for requirement in requirements)
    blocked = tuple(verdict for verdict in verdicts if verdict.blocks)

    if signals.checked_in:
        # Every requirement is spent (see the module docstring). ``ready`` is not:
        # it is data completeness -- approved, and holding a rank in the balancer
        # pool -- and the organizer has separate controls for it.
        return AdmissionEvaluation(
            decision=AdmissionDecision.admitted if signals.ready else AdmissionDecision.not_admitted,
            requirements=verdicts,
            blockers=(),
            overridden=blocked,
            checked_in=True,
            ready=signals.ready,
        )

    blockers = tuple(verdict for verdict in blocked if blocks_at(verdict, stage))
    # ``overridden`` stays empty: it means "gate already behind", and before
    # check-in no requirement's gate is. A requirement blocked at ``check_in``
    # while ``stage`` is ``registration`` is due LATER, so it belongs to neither
    # list -- it is still visible in ``requirements`` with its blocked state, and
    # calling it overridden would tell the registrant the rule had been waived.
    decision = AdmissionDecision.not_admitted if blockers or not signals.ready else AdmissionDecision.pending_check_in
    return AdmissionEvaluation(
        decision=decision,
        requirements=verdicts,
        blockers=blockers,
        overridden=(),
        checked_in=False,
        ready=signals.ready,
    )
