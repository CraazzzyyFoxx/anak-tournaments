"""The pure admission core, driven with stub requirements.

Deliberately imports neither ``registry.py`` nor the ``requirements/`` package.
The claims below are about the DECISION -- what blocks, when it blocks, and what
check-in spends -- and every one of them has to hold for every
:class:`RequirementState` at every :class:`AdmissionStage`. Reaching that cross
product through the production evaluators would mean building a
``battle_tag_state`` row and a Discord provider verdict for each cell, and the
invariants would then only be checked for the states those fixtures happen to
produce. A requirement whose evaluator returns one fixed verdict reaches all of
them, and cannot pass by accident because the real evaluator agreed.

Two invariants here are the reason the layer exists at all, and both name a
concrete production cost in their docstring: the fail-open rule (only ``blocked``
blocks) and D2 (check-in spends every requirement).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from shared.services.admission.config import AdmissionConfig  # noqa: E402
from shared.services.admission.evaluate import evaluate  # noqa: E402
from shared.services.admission.signals import AdmissionSignals  # noqa: E402
from shared.services.admission.types import (  # noqa: E402
    APPROVED_REGISTRATION_STATUS,
    READY_BALANCER_STATUS,
    AdmissionDecision,
    AdmissionStage,
    Requirement,
    RequirementState,
    RequirementVerdict,
)

#: The stubs ignore the config entirely, so the all-off default is enough: this
#: module tests the core's arithmetic over verdicts, not how a form is read.
CONFIG = AdmissionConfig()

STAGES = (AdmissionStage.registration, AdmissionStage.check_in)

#: Every state that must NOT block, which is every state except ``blocked``.
FAIL_OPEN_STATES = (
    RequirementState.satisfied,
    RequirementState.undetermined,
    RequirementState.not_applicable,
)


def _requirement(
    key: str = "stub",
    *,
    state: RequirementState = RequirementState.satisfied,
    stage: AdmissionStage = AdmissionStage.check_in,
) -> Requirement:
    """A registry entry whose evaluator returns one fixed verdict."""
    verdict = RequirementVerdict(key=key, state=state, stage=stage)
    return Requirement(
        key=key,
        enabled=lambda _config: True,
        stage=lambda _config: stage,
        evaluate=lambda _config, _signals, _stage: verdict,
    )


def _signals(*, checked_in: bool = False, ready: bool = True) -> AdmissionSignals:
    """Signals whose ``ready`` comes from the real property, not a flag.

    Setting the two lifecycle fields rather than stubbing ``ready`` keeps these
    tests honest about which literals count as ready; the core reads the
    property, so faking it would test a different object.
    """
    return AdmissionSignals(
        registration_id=1,
        status=APPROVED_REGISTRATION_STATUS if ready else "pending",
        balancer_status=READY_BALANCER_STATUS if ready else None,
        checked_in=checked_in,
    )


# ── fail-open ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("stage", STAGES)
@pytest.mark.parametrize("requirement_stage", STAGES)
@pytest.mark.parametrize("state", FAIL_OPEN_STATES)
def test_only_blocked_state_ever_blocks(
    state: RequirementState,
    requirement_stage: AdmissionStage,
    stage: AdmissionStage,
) -> None:
    """``satisfied`` / ``undetermined`` / ``not_applicable`` never refuse anyone.

    ``undetermined`` is the load-bearing one: a Discord outage, a token missing a
    newly added scope, or a rank collection nobody has run yet. The cost of this
    regression is refusing a paying subscriber during a live check-in, at the one
    moment they cannot do anything about it -- so it is asserted for every
    non-blocking state, at both gates, for a requirement gated at either.
    """
    evaluation = evaluate(
        CONFIG,
        _signals(),
        stage=stage,
        requirements=(_requirement(state=state, stage=requirement_stage),),
    )

    assert evaluation.blockers == ()
    assert evaluation.overridden == ()
    assert evaluation.decision is AdmissionDecision.pending_check_in
    assert evaluation.admitted is False

    # Non-vacuity: the same shape with ``blocked`` must be refused, or every
    # assertion above would also pass against an ``evaluate`` that blocks nothing.
    refused = evaluate(
        CONFIG,
        _signals(),
        stage=stage,
        requirements=(_requirement(state=RequirementState.blocked, stage=AdmissionStage.registration),),
    )
    assert refused.decision is AdmissionDecision.not_admitted


# ── D2: check-in spends every requirement ────────────────────────────────────


@pytest.mark.parametrize("stage", STAGES)
@pytest.mark.parametrize("requirement_stage", STAGES)
def test_checked_in_spends_a_blocked_requirement(
    requirement_stage: AdmissionStage,
    stage: AdmissionStage,
) -> None:
    """A checked-in player with an unmet requirement is admitted, not refused.

    Check-in is the last gate of every requirement (``registration`` implies
    ``check_in``), so passing it -- publicly, or because an organizer checked the
    player in by hand -- ends the question. The cost of this regression is the
    original bug: an organizer deliberately admits a player whose profile is
    private, and the badge reads "not admitted" forever, because the admin path
    was already an override mechanism that was broken only where it was shown.

    The blocked requirement is not hidden. It moves to ``overridden``, which is
    what the neutral wording ("requirement unmet -- admission already granted")
    is rendered from.
    """
    evaluation = evaluate(
        CONFIG,
        _signals(checked_in=True),
        stage=stage,
        requirements=(_requirement(state=RequirementState.blocked, stage=requirement_stage),),
    )

    assert evaluation.decision is AdmissionDecision.admitted
    assert evaluation.admitted is True
    assert evaluation.blockers == ()
    assert [verdict.key for verdict in evaluation.overridden] == ["stub"]
    assert evaluation.overridden[0].state is RequirementState.blocked
    assert evaluation.overridden[0].stage is requirement_stage


@pytest.mark.parametrize("stage", STAGES)
def test_checked_in_but_not_ready_is_still_not_admitted(stage: AdmissionStage) -> None:
    """``ready`` is data completeness and is never spent by check-in (D3).

    Approved and holding a rank in the balancer pool is not a requirement the
    player passes: it is whether the row is complete enough to be drafted, and
    the organizer has separate controls for it. Folding it into the D2
    short-circuit would report an unranked player as admitted and hand the
    balancer a registration it cannot place.
    """
    evaluation = evaluate(
        CONFIG,
        _signals(checked_in=True, ready=False),
        stage=stage,
        requirements=(_requirement(state=RequirementState.blocked, stage=AdmissionStage.check_in),),
    )

    assert evaluation.decision is AdmissionDecision.not_admitted
    assert evaluation.ready is False
    assert evaluation.blockers == ()
    assert len(evaluation.overridden) == 1


# ── stage ordering ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("stage", STAGES)
def test_registration_stage_blocker_blocks_at_both_gates(stage: AdmissionStage) -> None:
    """``registration`` implies ``check_in``: the earlier gate bites at both.

    ``AdmissionStage`` is ordered, not a set. Treating it as a set would let a
    requirement the organizer armed at sign-up be re-passed at check-in by a
    player who had never satisfied it -- the toggle would simply stop applying
    after the first gate.
    """
    evaluation = evaluate(
        CONFIG,
        _signals(),
        stage=stage,
        requirements=(_requirement(state=RequirementState.blocked, stage=AdmissionStage.registration),),
    )

    assert [verdict.key for verdict in evaluation.blockers] == ["stub"]
    assert evaluation.decision is AdmissionDecision.not_admitted
    assert evaluation.overridden == ()


def test_check_in_stage_blocker_is_silent_during_registration() -> None:
    """The later gate must not bite early, and is not "overridden" either.

    A requirement gated at check-in is due LATER, so it belongs to neither list:
    reporting it as a blocker would refuse a sign-up the organizer explicitly
    configured to be allowed, and reporting it as ``overridden`` would tell the
    registrant the rule had already been waived. It stays visible in
    ``requirements`` with its blocked state, which is what the progress steps
    render.
    """
    evaluation = evaluate(
        CONFIG,
        _signals(),
        stage=AdmissionStage.registration,
        requirements=(_requirement(state=RequirementState.blocked, stage=AdmissionStage.check_in),),
    )

    assert evaluation.blockers == ()
    assert evaluation.overridden == ()
    assert evaluation.decision is AdmissionDecision.pending_check_in
    assert evaluation.requirement("stub").state is RequirementState.blocked


def test_check_in_stage_blocker_blocks_at_check_in() -> None:
    """The mirror of the test above: the same requirement does bite at its gate."""
    evaluation = evaluate(
        CONFIG,
        _signals(),
        stage=AdmissionStage.check_in,
        requirements=(_requirement(state=RequirementState.blocked, stage=AdmissionStage.check_in),),
    )

    assert [verdict.key for verdict in evaluation.blockers] == ["stub"]
    assert evaluation.decision is AdmissionDecision.not_admitted


# ── disabled requirements ────────────────────────────────────────────────────


def test_disabled_requirement_is_never_evaluated_but_still_reported() -> None:
    """A switched-off requirement is answered without asking its evaluator.

    Its evaluator cannot answer honestly: the resolver skips signals for
    requirements this tournament switched off, so the evaluator would be reading
    ``None`` and would have to infer "disabled" from "nothing resolved" --
    collapsing ``not_applicable`` into ``undetermined``, which is the distinction
    an organizer uses to tell "I did not ask for this" from "we could not check".

    It still ships in ``requirements``: the registrant's progress steps are built
    by walking that tuple, and filtering here would push a ``require_x`` branch
    back into the UI once per requirement -- the shape this layer replaces.
    """

    def _boom(_config: object, _signals: object, _stage: object) -> RequirementVerdict:
        raise AssertionError("a disabled requirement's evaluate() must never be called")

    requirement = Requirement(
        key="off",
        enabled=lambda _config: False,
        stage=lambda _config: AdmissionStage.check_in,
        evaluate=_boom,  # type: ignore[arg-type]
    )

    evaluation = evaluate(CONFIG, _signals(), stage=AdmissionStage.check_in, requirements=(requirement,))

    verdict = evaluation.requirement("off")
    assert verdict is not None
    assert verdict.state is RequirementState.not_applicable
    assert verdict.stage is AdmissionStage.check_in
    assert verdict.reasons == ()
    assert evaluation.blockers == ()
    assert evaluation.decision is AdmissionDecision.pending_check_in


def test_requirements_keeps_every_entry_in_registry_order() -> None:
    """The progress steps walk this tuple, so order and completeness are contract.

    Dropping the disabled entry, or re-ordering around the blocked one, silently
    reshuffles the steps the registrant reads to work out what to fix next.
    """
    evaluation = evaluate(
        CONFIG,
        _signals(),
        stage=AdmissionStage.check_in,
        requirements=(
            _requirement("first", state=RequirementState.satisfied),
            Requirement(
                key="middle",
                enabled=lambda _config: False,
                stage=lambda _config: AdmissionStage.registration,
                evaluate=_requirement("middle").evaluate,
            ),
            _requirement("last", state=RequirementState.blocked),
        ),
    )

    assert [verdict.key for verdict in evaluation.requirements] == ["first", "middle", "last"]
    assert [verdict.state for verdict in evaluation.requirements] == [
        RequirementState.satisfied,
        RequirementState.not_applicable,
        RequirementState.blocked,
    ]
    assert [verdict.key for verdict in evaluation.blockers] == ["last"]


# ── happy path ───────────────────────────────────────────────────────────────


def test_no_enabled_requirements_and_ready_is_pending_check_in() -> None:
    """Nothing to enforce and a complete row: the player still has to check in.

    ``pending_check_in`` rather than ``admitted`` -- check-in is the transition
    that grants admission, and a tournament with no requirements has not stopped
    having a check-in.
    """
    evaluation = evaluate(CONFIG, _signals(), stage=AdmissionStage.check_in, requirements=())

    assert evaluation.decision is AdmissionDecision.pending_check_in
    assert evaluation.requirements == ()
    assert evaluation.blockers == ()
    assert evaluation.overridden == ()
    assert evaluation.checked_in is False
    assert evaluation.ready is True


def test_not_ready_is_not_admitted_even_with_nothing_to_enforce() -> None:
    """An unapproved or unranked row is refused on its own, without a blocker."""
    evaluation = evaluate(
        CONFIG,
        _signals(ready=False),
        stage=AdmissionStage.check_in,
        requirements=(_requirement(state=RequirementState.satisfied),),
    )

    assert evaluation.decision is AdmissionDecision.not_admitted
    assert evaluation.blockers == ()
    assert evaluation.ready is False
