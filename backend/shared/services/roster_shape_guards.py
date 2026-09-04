"""Guard protecting the workspace-default roster shape from moving under a draft.

Sibling of :mod:`shared.services.draft_guards` and
:mod:`shared.services.registration_team_guards`, and the reason it exists as a
third module: those two ask about ONE tournament, and the workspace default is
inherited by every tournament that carries no ``roster_slots_json`` override
(``shared.domain.roster_shape.resolve_roster_shape``). The per-tournament admin
write refuses a shape change while a draft is in flight or a team still holds
slots; without the same check on the workspace default, editing it silently
re-shapes every inheriting tournament — including one whose draft is mid-pick,
which then validates picks against a roster nobody drafted into. A 1/2/2 draft
suddenly accepting a second tank is exactly that.

The blocking predicates are imported, never restated: this module only scopes
them to the inheriting tournaments of one workspace.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import sqlalchemy as sa

from shared.core import http_status as status
from shared.core.errors import BaseAPIException
from shared.models.balancer.draft import DraftSession
from shared.models.registration.registration import BalancerRegistrationTeam
from shared.models.tournament import Tournament
from shared.services.draft_guards import unfinished_draft_clause
from shared.services.registration_team_guards import teams_holding_slots_clause

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = ("assert_workspace_roster_shape_unlocked", "workspace_roster_shape_lock")


def _inheriting(workspace_id: int) -> sa.ColumnElement[bool]:
    """Tournaments of this workspace that read the default instead of an override."""
    return sa.and_(
        Tournament.workspace_id == workspace_id,
        Tournament.roster_slots_json.is_(None),
    )


async def workspace_roster_shape_lock(session: AsyncSession, workspace_id: int) -> tuple[int, str] | None:
    """``(tournament_id, reason)`` of the first tournament locking the default.

    Two ``LIMIT 1`` reads rather than one per tournament: a workspace can hold
    dozens, and this runs on an admin write path that must stay a fixed cost.
    """
    draft = (
        await session.execute(
            sa.select(Tournament.id, DraftSession.status)
            .join(DraftSession, DraftSession.tournament_id == Tournament.id)
            .where(_inheriting(workspace_id), unfinished_draft_clause())
            .limit(1)
        )
    ).first()
    if draft is not None:
        return draft[0], f"a draft session is active (status: {draft[1]})"

    team = (
        await session.execute(
            sa.select(Tournament.id, BalancerRegistrationTeam.status)
            .join(BalancerRegistrationTeam, BalancerRegistrationTeam.tournament_id == Tournament.id)
            .where(_inheriting(workspace_id), teams_holding_slots_clause())
            .limit(1)
        )
    ).first()
    if team is not None:
        return team[0], f"teams are registered (a team is currently '{team[1]})'"
    return None


async def assert_workspace_roster_shape_unlocked(session: AsyncSession, workspace_id: int) -> None:
    """Raise a business error when an inheriting tournament has locked the shape."""
    lock = await workspace_roster_shape_lock(session, workspace_id)
    if lock is None:
        return
    tournament_id, reason = lock
    raise BaseAPIException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Cannot change the default roster shape: tournament {tournament_id} inherits it and "
            f"{reason}. Give that tournament its own roster shape, or finish the draft first."
        ),
    )
