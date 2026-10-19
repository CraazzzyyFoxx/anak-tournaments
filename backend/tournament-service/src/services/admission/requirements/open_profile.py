"""The "All Profiles Open" requirement: :class:`ProfileSignal` -> verdict.

Pure mapping. Everything expensive already happened in
``shared.services.profile_visibility.resolve_profiles_open``, which is where the
``battle_tag_state`` read is batched and where the reasons are produced; this
module only decides which :class:`RequirementState` the tri-state corresponds to.

The tri-state is read with ``is`` and never by truthiness, because ``False`` and
``None`` are the two values whose meanings are OPPOSITE here -- one refuses a
player, the other must not -- and they are indistinguishable to an ``if not``.
That is the fail-open invariant in its most easily broken form: an unpolled or
errored collection has to pass. A stalled parser is a system problem, and turning
it into a refusal would empty a tournament's check-in over an outage nobody in
the product caused.
"""

from __future__ import annotations

from shared.services.admission.config import AdmissionConfig
from shared.services.admission.signals import AdmissionSignals
from shared.services.admission.types import AdmissionStage, RequirementState, RequirementVerdict

__all__ = ("KEY", "eval_open_profile")

KEY = "open_profile"


def eval_open_profile(config: AdmissionConfig, signals: AdmissionSignals, stage: AdmissionStage) -> RequirementVerdict:
    """Project one registration's profile signal into a verdict.

    ``signals.profile is None`` means the resolver was never asked -- the
    requirement is off for this tournament, or this registration was not part of
    the batch. Both are "not determined", and neither is evidence against the
    player, so no reasons are attached either: an empty ``undetermined`` reads
    correctly as "we did not look", where a fabricated reason would read as "we
    looked and something was wrong".
    """
    signal = signals.profile
    if signal is None:
        return RequirementVerdict(key=KEY, state=RequirementState.undetermined, stage=stage)

    if signal.is_open is False:
        state = RequirementState.blocked
    elif signal.is_open is True:
        state = RequirementState.satisfied
    else:
        state = RequirementState.undetermined

    return RequirementVerdict(
        key=KEY,
        state=state,
        stage=stage,
        # A public profile has nothing to explain. Enforced here rather than
        # trusted from the signal, so a hand-built ``ProfileSignal(True, reasons)``
        # cannot render a green row with a complaint stapled to it.
        reasons=() if signal.is_open is True else signal.reasons,
        # Read by the row chips only, never by ``evaluate``: the scope tells the
        # organizer whether a green tick covered the smurfs too.
        detail={"scope": config.open_profile_scope, "profiles_open": signal.is_open},
    )
