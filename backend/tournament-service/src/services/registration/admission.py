"""The one place a write path asks "is this player allowed through this gate".

``reg_pub_create``, ``regteam_create`` and ``reg_pub_check_in`` all ask through
one call with an explicit ``stage``, so which requirement bites at which moment
is decided here rather than by the presence and order of calls across handlers.

**The config is loaded once per request and passed by value**: an organizer can
edit the form live, so two reads within one submit could legitimately disagree.
The toggles and the workspace rule are one frozen value, and everything
downstream projects from it.

**``load_admission_config`` reads the form through**
``_common_service.get_registration_form``, which is the single form reader. It is
not cached and must not be: an organizer changes the form in real time, and a
stale read is either a false refusal or a false admission.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.clients import subscription_resolver
from src.services.admission import AdmissionConfig, AdmissionEvaluation, AdmissionStage
from src.services.admission.gates import assert_admitted
from src.services.admission.resolve import resolve_admission_for_gate
from src.services.registration._common import _common_service

__all__ = ("assert_admitted_at", "load_admission_config")


async def load_admission_config(
    session: AsyncSession,
    tournament_id: int,
    *,
    resolver: Any | None = None,
) -> AdmissionConfig:
    """Assemble the tournament's toggles and its workspace's rule into one value.

    The two owners stay separate on purpose and are folded only here: the form
    holds whether this tournament requires the thing, the workspace holds the rule
    itself, so a new tournament does not re-declare which providers count.

    The rule is fetched only when the toggle is on. That ordering is the whole
    reason a tournament with subscriptions switched off pays nothing on this path,
    and it matches ``AdmissionConfig.enforces_subscription``, which treats an
    armed toggle over an absent rule as nothing to enforce rather than as a
    refusal -- the resolver owns the parse and fails open on a malformed row, so
    "the config is broken" must never read as "you fail the rule".

    ``resolver`` lets a caller that already holds one hand it over instead of
    paying for a second. It is optional because the read paths have no resolver of
    their own and only need the rule row.
    """
    form = await _common_service.get_registration_form(session, tournament_id)
    rule = None
    if form is not None and form.require_subscription:
        rule = await (resolver or subscription_resolver(session)).load_requirement(workspace_id=form.workspace_id)
    return AdmissionConfig.from_form(form, subscription_rule=rule)


async def assert_admitted_at(
    session: AsyncSession,
    registration: Any | None,
    *,
    tournament_id: int,
    auth_user_id: int,
    stage: AdmissionStage,
) -> AdmissionEvaluation:
    """Refuse this subject at ``stage``, or return why it did not have to.

    The evaluation comes back so a caller can read the same answer the gate
    decided on -- the check-in handler serializes it into its response rather than
    resolving a second time.

    ``registration`` is ``None`` at sign-up, where the row does not exist yet, and
    ``auth_user_id`` is what identifies the subject in that case (see
    ``resolve_admission_for_gate``). One consequence matters: with no row every
    lifecycle fact is falsy, so ``ready`` is false and ``decision`` comes back
    ``not_admitted`` for a perfectly acceptable applicant. **Never gate on
    ``decision`` here** -- only on ``blockers``, which is exactly what
    :func:`assert_admitted` reads. ``ready`` is data completeness (approved, ranked
    in the balancer pool), not a requirement, and it is not this gate's business.
    """
    resolver = subscription_resolver(session)
    config = await load_admission_config(session, tournament_id, resolver=resolver)
    evaluation = await resolve_admission_for_gate(
        session,
        registration,
        config=config,
        resolver=resolver,
        stage=stage,
        auth_user_id=auth_user_id,
    )
    assert_admitted(evaluation, stage=stage, config=config)
    return evaluation
