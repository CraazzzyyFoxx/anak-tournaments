"""Attach subscription verdicts to registration reads.

Read-side counterpart of ``subscription_gate``. Two guarantees:

- **One pass for the whole list.** Resolving per registration would fan out
  behind Discord's per-guild rate-limit bucket and make a 200-row participants
  page unusable. ``force_refresh`` is always ``False`` here; only check-in forces
  a fresh look, and only for the one acting user.
- **One pass for both consumers.** The composed ``Outcome`` drives the admin
  column and ``isAdmitted``; the per-provider verdicts drive the per-row chips.
  Both come from the same call.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.subscriptions import Outcome, SubscriptionRequirement, SubscriptionVerdict, parse_requirement

__all__ = (
    "RegistrationSubscription",
    "build_subscription_reads",
    "load_auth_user_ids_by_registration",
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


def serialize_verdicts(
    verdicts: Mapping[str, SubscriptionVerdict],
) -> dict[str, dict[str, Any]]:
    """Public projection of the per-provider verdicts.

    Deliberately narrow: ``evidence`` can hold guild ids and role ids, which are
    internal. Only ``reason`` is exposed, because the UI branches on it to pick a
    call to action ("link Discord" vs "reconnect Twitch").
    """
    return {
        provider: {
            "state": verdict.state,
            "tier_rank": verdict.tier_rank,
            "tier_label": verdict.tier_label,
            "reason": verdict.evidence.get("reason"),
        }
        for provider, verdict in verdicts.items()
    }


async def load_auth_user_ids_by_registration(
    session: AsyncSession, registrations: Sequence[Any]
) -> dict[int, int | None]:
    """Map ``registration.id`` -> ``auth.user.id``.

    Entitlements are keyed on the site account, but a registration only anchors to
    a ``workspace_member`` -> ``players.user`` -> ``auth_user_id``. A registration
    with no linked account yields ``None`` and is skipped rather than resolved.
    """
    reg_ids = [reg.id for reg in registrations]
    if not reg_ids:
        return {}
    rows = await session.execute(
        sa.select(models.BalancerRegistration.id, models.User.auth_user_id)
        .select_from(models.BalancerRegistration)
        .join(
            models.WorkspaceMember,
            models.BalancerRegistration.workspace_member_id == models.WorkspaceMember.id,
        )
        .join(models.User, models.WorkspaceMember.player_id == models.User.id)
        .where(models.BalancerRegistration.id.in_(reg_ids))
    )
    # `.tuples()` is what makes this a real 2-tuple: without it a `Row` is not an
    # `Iterable[tuple[...]]` and `dict()` does not type-check.
    mapped = dict(rows.tuples().all())
    return {reg_id: mapped.get(reg_id) for reg_id in reg_ids}


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

    try:
        requirement = parse_requirement(getattr(form, "subscription_requirement_json", None))
    except ValueError:
        # Malformed config is rejected on save; surfacing nothing beats 500ing a
        # public participants list.
        return {}
    if not requirement.requirements:
        return {}

    user_ids = list(dict.fromkeys(uid for uid in auth_user_id_by_registration.values() if uid is not None))
    if not user_ids:
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
