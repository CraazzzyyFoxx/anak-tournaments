"""The admission vocabulary: one evaluation, many projections.

This layer exists because "is this player admitted" was answered in five places
on the client and nowhere on the server, and because the five answers each needed
a DIFFERENT SHAPE of the same computation -- a boolean, three states, a sort
ordinal, a search string, an HTTP 400 with the rule spelled out, and a
per-requirement tone+label for the registrant's own progress steps.

That is why :class:`AdmissionEvaluation` is not a boolean and never will be. A
boolean would have forced the sixth consumer to re-derive the breakdown, which is
exactly how the five copies were born. Every consumer PROJECTS from this
structure; none recomputes it.

Three properties are load-bearing. Change them only deliberately:

**Only ``blocked`` blocks.** ``undetermined`` fails open, mirroring
``shared.services.profile_visibility`` and ``meets_min_tier``. A provider outage,
an unlinked account or a token missing a new scope must never un-admit a paying
subscriber mid-check-in.

**Check-in spends every requirement.** Requirements are gates on TRANSITIONS, not
invariants on state. ``registration`` implies ``check_in`` (see
``SubscriptionEnforcementStage``), so check-in is the last gate of every
requirement, and passing it -- through the public gate or by an organizer's manual
override -- ends the question. See :class:`AdmissionEvaluation.overridden`.

**``requirements`` carries every requirement, including the disabled ones.** The
registrant's progress steps are built by walking that tuple. Filtering it here
would push a `if config.require_x` branch back into the UI, once per requirement,
which is the shape this layer replaces.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from shared.services.admission.config import AdmissionConfig
    from shared.services.admission.signals import AdmissionSignals

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

#: The two literals that make a registration eligible at all. Spelled out here
#: rather than derived from the status catalog: the client has compared against
#: these exact strings since the badge was written, and widening the definition to
#: custom statuses' ``excludes_from_ready`` is a behaviour change, not a refactor.
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
    ``shared.core.enums.SubscriptionEnforcementStage``, widened to every
    requirement so "when does this bite" stops being expressed by the position of
    a call in one RPC handler.
    """

    registration = "registration"
    check_in = "check_in"


class AdmissionDecision(StrEnum):
    admitted = "admitted"
    pending_check_in = "pending_check_in"
    not_admitted = "not_admitted"


class ReasonActor(StrEnum):
    """Who can actually fix this reason.

    The point of the whole taxonomy. A reason code alone tells an organizer what
    happened; the actor tells them whether forty ``undetermined`` rows are forty
    players who never linked Discord (their problem) or one broken role mapping
    (his). Those demand different actions and the code alone cannot distinguish
    them.
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

    ``code`` is a stable machine value; the UI renders ``admission.reason.{code}``
    and the gates build their 400 from the same list, so there is ONE taxonomy
    behind both outputs rather than a Russian literal in ``subscription_gate`` and
    an i18n key on the client.

    ``subject`` names what the reason is about -- a provider key (``"discord"``), or
    the BattleTag that failed. Under ``open_profile_scope="all"`` a registrant may
    carry three tags and have exactly one closed; without ``subject`` the organizer
    cannot tell which.
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
    #: Blocked requirements whose gate is already behind -- the organizer's manual
    #: check-in admitted the player anyway, or the requirement lapsed after a
    #: legitimate check-in. Those two are INDISTINGUISHABLE here (the verdicts hold
    #: no as-of time), so word it neutrally: "requirement unmet -- admission
    #: already granted", never "granted manually".
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
    """One registry entry.

    Adding a third requirement is one of these plus one signal resolver -- not an
    edit to five client-side copies, two gates and two serializers.
    """

    key: str
    #: Whether this tournament switched the requirement on at all.
    enabled: Callable[[AdmissionConfig], bool]
    #: The earliest gate it blocks at, given the config.
    stage: Callable[[AdmissionConfig], AdmissionStage]
    #: Maps raw signals to a verdict. MUST be synchronous and MUST NOT do I/O:
    #: the batch contract (one pass for a 200-row list, because Discord
    #: rate-limits per guild) is enforced by this signature, not by a comment.
    evaluate: Callable[[AdmissionConfig, AdmissionSignals, AdmissionStage], RequirementVerdict]
