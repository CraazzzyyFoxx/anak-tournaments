"""One place that answers "is this player admitted", in one shape.

Read ``types.py`` first: it states the three load-bearing properties (only
``blocked`` blocks, check-in spends every requirement, and ``requirements``
carries the disabled ones too).

Layout:

- ``types.py``    -- the vocabulary and :class:`Requirement`
- ``reasons.py``  -- reason code -> :class:`ReasonActor`
- ``signals.py``  -- raw resolved inputs, one struct per registration
- ``config.py``   -- the tournament's toggles + the workspace's rule
- ``registry.py`` -- the requirement list; adding one is an entry plus a resolver
- ``evaluate.py`` -- the pure decision; synchronous, no I/O, ever
- ``resolve.py``  -- all the I/O, batched once per list
- ``gates.py``    -- HTTP projection: raise from ``blockers``

``requirements/`` holds one module per requirement: the mapping from its raw
signal to a :class:`RequirementVerdict`, next to nothing else.
"""

from __future__ import annotations

from shared.services.admission.config import AdmissionConfig
from shared.services.admission.reasons import REASON_ACTORS, actor_for, reason
from shared.services.admission.signals import AdmissionSignals, ProfileSignal, SubscriptionSignal
from shared.services.admission.types import (
    AdmissionDecision,
    AdmissionEvaluation,
    AdmissionReason,
    AdmissionStage,
    ReasonActor,
    Requirement,
    RequirementState,
    RequirementVerdict,
)

__all__ = (
    "REASON_ACTORS",
    "AdmissionConfig",
    "AdmissionDecision",
    "AdmissionEvaluation",
    "AdmissionReason",
    "AdmissionSignals",
    "AdmissionStage",
    "ProfileSignal",
    "ReasonActor",
    "Requirement",
    "RequirementState",
    "RequirementVerdict",
    "SubscriptionSignal",
    "actor_for",
    "reason",
)
