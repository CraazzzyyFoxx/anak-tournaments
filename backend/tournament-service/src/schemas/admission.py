"""Wire shape of one :class:`AdmissionEvaluation`.

Shared verbatim by the public participants read and the admin registrations
table, and that is the point: those two surfaces used to answer "is this player
admitted" from five separate client-side re-derivations of five raw fields, two of
which deliberately disagreed with the other three. They now render the same
object, and a disagreement between them becomes impossible rather than merely
discouraged.

Deliberately NOT a lossy projection. Consumers need different shapes of the same
answer -- a badge wants three states, the sort column wants an ordinal, the search
index wants text, the registrant's progress steps want one entry per requirement
with its own tone -- so everything they project from ships here. `requirements`
therefore carries disabled requirements too: the progress steps are built by
walking it, and filtering it here would push a `if require_x` branch back into the
UI once per requirement, which is the shape this whole layer replaces.

`profiles_open` and `subscription_outcome` stay on the registration reads beside
this object. They are not duplicates of the decision: the per-row Profile and
Subscription chips render them directly, and folding them in here would make the
chips reach into `requirements[].detail` for data they already have.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from shared.services.admission.types import (
    AdmissionEvaluation,
    AdmissionReason,
    RequirementVerdict,
)

__all__ = ("AdmissionReasonRead", "AdmissionRead", "RequirementVerdictRead")


class AdmissionReasonRead(BaseModel):
    """Why a requirement is not satisfied, and who can fix it.

    ``code`` is a stable machine value; the client renders
    ``admission.reason.{code}`` and falls back to the raw code, so a provider added
    later is still explainable without a deploy on both sides.

    ``actor`` is what makes the aggregate readable: forty ``undetermined`` rows are
    either forty players who never linked Discord or one broken role mapping, and
    the code alone cannot tell an organizer which of those to go and fix.
    """

    code: str
    actor: Literal["player", "organizer", "system"]
    #: What the reason is about -- a provider key, or the BattleTag that failed.
    #: Under ``open_profile_scope="all"`` a registrant may carry three tags with
    #: exactly one closed, and without this the verdict names none of them.
    subject: str | None = None

    @classmethod
    def of(cls, reason: AdmissionReason) -> AdmissionReasonRead:
        return cls(code=reason.code, actor=reason.actor.value, subject=reason.subject)


class RequirementVerdictRead(BaseModel):
    key: str
    state: Literal["satisfied", "blocked", "undetermined", "not_applicable"]
    #: The earliest gate this requirement blocks at. Ordered: ``registration``
    #: implies ``check_in`` as well.
    stage: Literal["registration", "check_in"]
    reasons: list[AdmissionReasonRead] = Field(default_factory=list)
    #: Requirement-shaped extras for the row chips (per-provider verdicts, the
    #: resolved profile scope). Never a decision input.
    detail: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def of(cls, verdict: RequirementVerdict) -> RequirementVerdictRead:
        return cls(
            key=verdict.key,
            state=verdict.state.value,
            stage=verdict.stage.value,
            reasons=[AdmissionReasonRead.of(reason) for reason in verdict.reasons],
            detail=dict(verdict.detail),
        )


class AdmissionRead(BaseModel):
    decision: Literal["admitted", "pending_check_in", "not_admitted"]
    #: Every requirement in the registry, in registry order, including the ones
    #: this tournament switched off (``state="not_applicable"``).
    requirements: list[RequirementVerdictRead] = Field(default_factory=list)
    #: Blocked requirements whose gate has already arrived. Drives ``decision``.
    blockers: list[RequirementVerdictRead] = Field(default_factory=list)
    #: Blocked requirements the player is admitted DESPITE, because check-in --
    #: the last gate of every requirement -- is already behind them.
    #:
    #: Word this neutrally in the UI: "requirement unmet, admission already
    #: granted". It cannot distinguish an organizer who checked somebody in by
    #: hand from a subscription that lapsed a week after a legitimate check-in,
    #: because the verdicts carry no as-of time. Claiming the former would
    #: routinely accuse an organizer of something they did not do.
    overridden: list[RequirementVerdictRead] = Field(default_factory=list)
    checked_in: bool = False
    #: ``approved`` and holding a rank in the balancer pool. Not a requirement,
    #: and never spent by check-in: it is data completeness, with its own controls.
    ready: bool = False

    @classmethod
    def of(cls, evaluation: AdmissionEvaluation) -> AdmissionRead:
        return cls(
            decision=evaluation.decision.value,
            requirements=[RequirementVerdictRead.of(v) for v in evaluation.requirements],
            blockers=[RequirementVerdictRead.of(v) for v in evaluation.blockers],
            overridden=[RequirementVerdictRead.of(v) for v in evaluation.overridden],
            checked_in=evaluation.checked_in,
            ready=evaluation.ready,
        )

    @classmethod
    def unknown(cls) -> AdmissionRead:
        """The read for a registration nothing was resolved for.

        Not ``None`` on the wire: an absent object would make every consumer write
        a null branch, and the five copies this layer replaces were born from
        exactly that kind of per-consumer defaulting. ``not_admitted`` with no
        requirements is the honest reading -- nothing was checked, so nothing is
        satisfied -- and it can only occur for a registration outside the resolved
        batch.
        """
        return cls(decision="not_admitted")
