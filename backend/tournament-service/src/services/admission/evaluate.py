"""The decision: signals in, one :class:`AdmissionEvaluation` out.

Synchronous and unable to do I/O: ``resolve.py`` pays for every signal once per
list (Discord rate-limits per guild) and hands the results here as plain data.

``requirements`` is a parameter, not an import of :data:`registry.REQUIREMENTS`,
so tests can drive the fail-open invariant and the stage ordering with stub
requirements for every :class:`RequirementState` at every stage.

Check-in spends every requirement. Requirements gate TRANSITIONS, not state, and
check-in is the last gate of every requirement, so once checked in -- through the
public gate or an organizer's manual check-in -- blocked requirements move to
``overridden`` instead of un-admitting the player.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from src.services.admission.config import AdmissionConfig
from src.services.admission.signals import AdmissionSignals
from src.services.admission.types import (
    AdmissionDecision,
    AdmissionEvaluation,
    AdmissionStage,
    Requirement,
    RequirementState,
    RequirementVerdict,
)

__all__ = ("blocks_at", "evaluate", "stage_reached")

#: Stage order as a rank: the enum values sort alphabetically backwards
#: (``"check_in" < "registration"``), so never compare the members directly.
_STAGE_RANK: Final[dict[AdmissionStage, int]] = {
    AdmissionStage.registration: 0,
    AdmissionStage.check_in: 1,
}


def stage_reached(requirement_stage: AdmissionStage, stage: AdmissionStage) -> bool:
    """Whether a requirement gated at ``requirement_stage`` is due by ``stage``.

    Also used by ``resolve.py`` to skip resolving a requirement that is not yet
    due: a check-in-staged rule must not cost a forced provider call, or write a
    sign-up-attributed check-log row, during sign-up.
    """
    return _STAGE_RANK[requirement_stage] <= _STAGE_RANK[stage]


def blocks_at(verdict: RequirementVerdict, stage: AdmissionStage) -> bool:
    """Whether ``verdict`` is a confirmed failure whose gate has already arrived.

    ``undetermined`` (outage, unlinked account, no collection yet) never blocks:
    it must not un-admit a paying subscriber during a live check-in. A
    requirement gated at ``registration`` also bites at ``check_in``; one gated
    at check-in stays silent during sign-up.
    """
    return verdict.blocks and stage_reached(verdict.stage, stage)


def _verdict_for(
    requirement: Requirement,
    config: AdmissionConfig,
    signals: AdmissionSignals,
) -> RequirementVerdict:
    """Ask one requirement, or answer ``not_applicable`` without asking it.

    A disabled requirement's signal was never resolved, so its evaluator would
    read ``None`` and confuse "switched off" with "lookup failed"
    (``undetermined``). The verdict still ships in ``requirements``: the
    registrant's progress steps walk that tuple.
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

    ``stage`` is the gate being asked about, passed explicitly at every write site.
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
    # ``overridden`` means "gate already behind", which no gate is before check-in.
    # A requirement blocked at ``check_in`` while ``stage`` is ``registration`` is in
    # neither list; calling it overridden would tell the registrant it was waived.
    decision = AdmissionDecision.not_admitted if blockers or not signals.ready else AdmissionDecision.pending_check_in
    return AdmissionEvaluation(
        decision=decision,
        requirements=verdicts,
        blockers=blockers,
        overridden=(),
        checked_in=False,
        ready=signals.ready,
    )
