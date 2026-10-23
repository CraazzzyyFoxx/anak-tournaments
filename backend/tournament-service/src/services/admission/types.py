"""The admission vocabulary: one evaluation, many projections.

Consumers need different shapes of the same computation -- a boolean, three
states, a sort ordinal, a search string, an HTTP 400 with the rule spelled out,
per-requirement progress steps -- so :class:`AdmissionEvaluation` is not a
boolean. Every consumer PROJECTS from it; none recomputes it.

Three properties are load-bearing. Change them only deliberately:

**Only ``blocked`` blocks.** ``undetermined`` fails open, as in
``src.services.admission.profile_visibility`` and ``meets_min_tier``: a provider
outage, an unlinked account or a token missing a new scope must never un-admit a
paying subscriber mid-check-in.

**Check-in spends every requirement.** Requirements are gates on TRANSITIONS, not
invariants on state. ``registration`` implies ``check_in``, so check-in is the
last gate of every requirement, and passing it -- through the public gate or an
organizer's manual override -- ends the question. See
:class:`AdmissionEvaluation.overridden`.

**``requirements`` carries every requirement, including the disabled ones.** The
registrant's progress steps walk that tuple; filtering it would push an
``if config.require_x`` branch into the UI once per requirement.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.services.admission.config import AdmissionConfig
    from src.services.admission.signals import AdmissionSignals

__all__ = (
    "APPROVED_REGISTRATION_STATUS",
    "READY_BALANCER_STATUS",
    "AdmissionDecision",
    "AdmissionReason",
    "AdmissionStage",
    "Requirement",
    "RequirementState",
    "RequirementVerdict",
    "ReasonActor",
    "AdmissionEvaluation",
)

#: The two literals that make a registration eligible at all. Not derived from
#: the status catalog: folding in custom statuses' ``excludes_from_ready`` would
#: change who counts as admitted.
APPROVED_REGISTRATION_STATUS = "approved"
READY_BALANCER_STATUS = "ready"


class RequirementState(StrEnum):
    """Kleene-style state of one requirement for one registration."""

    satisfied = "satisfied"
    #: A CONFIRMED failure -- the only state that blocks.
    blocked = "blocked"
    #: Could not be determined. Fails OPEN, always.
    undetermined = "undetermined"
    #: The requirement is switched off for this tournament.
    not_applicable = "not_applicable"


class AdmissionStage(StrEnum):
    """The EARLIEST gate a requirement blocks at.

    Ordered, not a set: ``registration`` implies ``check_in`` as well. Mirrors
    ``shared.core.enums.SubscriptionEnforcementStage``, widened to every requirement.
    """

    registration = "registration"
    check_in = "check_in"


class AdmissionDecision(StrEnum):
    admitted = "admitted"
    pending_check_in = "pending_check_in"
    not_admitted = "not_admitted"


class ReasonActor(StrEnum):
    """Who can actually fix this reason.

    The code says what happened; the actor tells an organizer whether forty
    ``undetermined`` rows are forty players who never linked Discord or one
    broken role mapping.
    """

    #: The registrant: link an account, reconnect a scope, open a profile, subscribe.
    player = "player"
    #: The organizer: configure the guild, fix the role mapping, name the broadcaster.
    organizer = "organizer"
    #: Nobody in the product: an outage, a pending collection, a missing deploy secret.
    system = "system"


@dataclass(frozen=True, slots=True)
class AdmissionReason:
    """Why a requirement is not ``satisfied``.

    ``code`` is a stable machine value: the UI renders ``admission.reason.{code}``
    and the gates build their 400 from the same list.

    ``subject`` names what the reason is about -- a provider key (``"discord"``)
    or the BattleTag that failed, so an organizer can tell which of three tags is
    closed under ``open_profile_scope="all"``.
    """

    code: str
    actor: ReasonActor
    subject: str | None = None


@dataclass(frozen=True, slots=True)
class RequirementVerdict:
    """One requirement's answer for one registration."""

    key: str
    state: RequirementState
    stage: AdmissionStage
    reasons: tuple[AdmissionReason, ...] = ()
    #: Requirement-shaped extras for the per-row chips (per-provider verdicts, the
    #: resolved profile scope). Never read by :func:`evaluate`.
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def blocks(self) -> bool:
        return self.state is RequirementState.blocked


@dataclass(frozen=True, slots=True)
class AdmissionEvaluation:
    """The single answer, in the one shape every consumer can project from."""

    decision: AdmissionDecision
    #: Every requirement in the registry, including ``not_applicable`` ones.
    requirements: tuple[RequirementVerdict, ...]
    #: Blocked requirements whose gate is still AHEAD. Drives ``decision`` and the
    #: gates' 400. Empty once ``checked_in`` is true.
    blockers: tuple[RequirementVerdict, ...]
    #: Blocked requirements whose gate is already behind: a manual check-in admitted
    #: the player anyway, or the requirement lapsed after check-in. The two are
    #: indistinguishable (no as-of time), so word it neutrally: "requirement unmet --
    #: admission already granted", never "granted manually".
    overridden: tuple[RequirementVerdict, ...]
    checked_in: bool
    #: ``approved`` and in the balancer pool with a rank. NOT a requirement and
    #: deliberately never spent by check-in: it is data completeness, and the
    #: organizer has its own controls (``set_balancer_status``).
    ready: bool

    @property
    def admitted(self) -> bool:
        return self.decision is AdmissionDecision.admitted

    def requirement(self, key: str) -> RequirementVerdict | None:
        return next((verdict for verdict in self.requirements if verdict.key == key), None)


@dataclass(frozen=True, slots=True)
class Requirement:
    """One registry entry; see ``registry.py``."""

    key: str
    #: Whether this tournament switched the requirement on at all.
    enabled: Callable[[AdmissionConfig], bool]
    #: The earliest gate it blocks at, given the config.
    stage: Callable[[AdmissionConfig], AdmissionStage]
    #: Maps raw signals to a verdict. MUST be synchronous and MUST NOT do I/O:
    #: signals are resolved once per list (Discord rate-limits per guild).
    evaluate: Callable[[AdmissionConfig, AdmissionSignals, AdmissionStage], RequirementVerdict]
