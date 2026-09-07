"""Attach subscription verdicts to ONE registration read.

TRANSITIONAL. ``shared.services.admission`` now owns this: the list paths --
public participants and admin registrations -- resolve a whole batch through
``admission.resolve.resolve_admission`` and read the per-provider projection out
of ``AdmissionEvaluation.requirements[].detail["providers"]``, which is the same
shape :func:`serialize_verdicts` produces.

What is left is kept alive by exactly one caller:
``src/rpc/public_rpc.py::_reg_pub_get_me`` (:445 and :463), the single-registration
public read. That handler is being moved onto the admission layer in the same
pass that rewrites the gates in that file; when it lands, this whole module goes
with it and the projection exists once.

The per-provider projection lives in ``shared`` as :func:`serialize_verdicts`.
This module re-exports it so existing tournament tests keep importing here.

The one guarantee still worth stating: ``force_refresh`` is always ``False``
here. Only check-in forces a fresh look, and only for the one acting user.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from shared.services.admission.requirements.subscription import serialize_verdicts
from shared.services.subscriptions import Outcome, SubscriptionRequirement, SubscriptionVerdict

__all__ = (
    "RegistrationSubscription",
    "build_subscription_reads",
    "serialize_verdicts",
)


@dataclass(frozen=True, slots=True)
class RegistrationSubscription:
    outcome: Outcome
    verdicts: dict[str, SubscriptionVerdict]


class RequirementEvaluator(Protocol):
    async def evaluate(
        self,
        *,
        workspace_id: int,
        auth_user_ids: Any,
        requirement: SubscriptionRequirement,
        force_refresh: bool = False,
    ) -> dict[int, tuple[Outcome, dict[str, SubscriptionVerdict]]]: ...

    async def load_requirement(self, *, workspace_id: int) -> SubscriptionRequirement | None: ...


async def build_subscription_reads(
    *,
    form: Any | None,
    auth_user_id_by_registration: Mapping[int, int | None],
    resolver: RequirementEvaluator,
) -> dict[int, RegistrationSubscription]:
    """Per-registration composed outcome plus per-provider verdicts.

    Returns ``{}`` -- and calls nothing -- whenever there is no requirement to
    report, so a tournament that does not use this feature pays nothing.
    """
    if form is None or not getattr(form, "require_subscription", False):
        return {}
    if not auth_user_id_by_registration:
        return {}

    # Cheapest guard first. `load_requirement` is a DB round trip, so a list whose
    # registrations all lack an `auth_user_id` must not pay for a rule it would
    # discard one line later -- the docstring above promises this calls nothing when
    # there is nothing to report.
    user_ids = list(dict.fromkeys(uid for uid in auth_user_id_by_registration.values() if uid is not None))
    if not user_ids:
        return {}

    # The workspace owns the rule; the resolver owns the parse and fails open on a
    # malformed row, so a bad config row surfaces nothing rather than 500ing a public
    # participants list.
    requirement = await resolver.load_requirement(workspace_id=form.workspace_id)
    if requirement is None:
        return {}

    outcomes = await resolver.evaluate(
        workspace_id=form.workspace_id,
        auth_user_ids=user_ids,
        requirement=requirement,
        force_refresh=False,
    )

    out: dict[int, RegistrationSubscription] = {}
    for reg_id, auth_user_id in auth_user_id_by_registration.items():
        if auth_user_id is None:
            continue
        resolved = outcomes.get(auth_user_id)
        if resolved is None:
            continue
        outcome, verdicts = resolved
        out[reg_id] = RegistrationSubscription(outcome=outcome, verdicts=dict(verdicts))
    return out
