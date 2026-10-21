"""Raw, already-resolved inputs for one registration.

The boundary between I/O and decision. Everything expensive -- the
``rank.account_state`` read, the entitlement read, any provider call -- happens once
per LIST in ``resolve.py`` and lands here as plain data.

The evaluators and :func:`~src.services.admission.evaluate.evaluate` therefore
take no session and cannot fan out per registration, which would serialize
behind Discord's per-guild rate-limit bucket.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.services.admission.types import (
    APPROVED_REGISTRATION_STATUS,
    READY_BALANCER_STATUS,
    AdmissionReason,
)

__all__ = ("AdmissionSignals", "ProfileSignal", "SubscriptionSignal")


@dataclass(frozen=True, slots=True)
class ProfileSignal:
    """Outcome of the "all profiles open" collection for one registration.

    ``is_open`` is ``True`` public, ``False`` confirmed closed, ``None`` unknown.
    ``reasons`` says which tag, and why it is not ``True``.
    """

    is_open: bool | None
    reasons: tuple[AdmissionReason, ...] = ()


@dataclass(frozen=True, slots=True)
class SubscriptionSignal:
    """Composed subscription answer plus the per-provider detail behind it.

    ``outcome`` is the value of ``shared.services.subscriptions.Outcome``, carried
    as a plain string so this module stays importable without the subscriptions
    package. Only ``"refused"`` blocks; ``"undetermined"`` fails open.

    ``reasons`` is already composed for the whole rule: under ``mode="any"`` two
    unresolved providers produce two reasons, and picking one here would hide
    half the answer from the organizer.
    """

    outcome: str
    reasons: tuple[AdmissionReason, ...] = ()
    #: Public per-provider projection for the row chips (``serialize_verdicts``
    #: shape). Passed through to ``RequirementVerdict.detail``, never decided on.
    providers: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AdmissionSignals:
    """One registration's lifecycle facts plus one signal per requirement.

    A signal is ``None`` when its requirement is off for this tournament, and the
    resolver then never paid for it. Requirement evaluators must treat ``None`` as
    "not asked", never as "failed".
    """

    registration_id: int
    status: str
    balancer_status: str | None
    checked_in: bool
    profile: ProfileSignal | None = None
    subscription: SubscriptionSignal | None = None

    @property
    def ready(self) -> bool:
        """Approved AND holding a rank in the balancer pool.

        Custom statuses carrying ``excludes_from_ready`` are deliberately NOT
        folded in: that would change who counts as admitted, a product decision.
        """
        return self.status == APPROVED_REGISTRATION_STATUS and self.balancer_status == READY_BALANCER_STATUS
