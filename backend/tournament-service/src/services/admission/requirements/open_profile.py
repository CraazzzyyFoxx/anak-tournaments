"""The "All Profiles Open" requirement: :class:`ProfileSignal` -> verdict.

Pure mapping; the batched read and the reasons come from
``src.services.admission.profile_visibility.resolve_profiles_open``.

The tri-state is read with ``is``, never by truthiness: ``False`` refuses and
``None`` (an unpolled or errored collection) must pass, and ``if not`` cannot
tell them apart.
"""

from __future__ import annotations

from src.services.admission.config import AdmissionConfig
from src.services.admission.signals import AdmissionSignals
from src.services.admission.types import AdmissionStage, RequirementState, RequirementVerdict

__all__ = ("KEY", "eval_open_profile")

KEY = "open_profile"


def eval_open_profile(config: AdmissionConfig, signals: AdmissionSignals, stage: AdmissionStage) -> RequirementVerdict:
    """Project one registration's profile signal into a verdict.

    ``signals.profile is None`` means the resolver was never asked (requirement
    off, or registration not in the batch): ``undetermined`` with no reasons,
    because a fabricated reason would read as "we looked and something was wrong".
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
