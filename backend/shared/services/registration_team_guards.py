"""Guards protecting tournament write-paths from conflicting registered teams.

Sibling of :mod:`shared.services.draft_guards`, and the same shape: one SELECT
that names the blocker, a boolean wrapper for the read-side flag, and an
assertion for the write path.

Why the roster shape needs this at all: every registered team's members carry a
``team_slot_code`` assigned from the shape that was in force when they accepted.
Changing ``roster_slots_json`` afterwards silently invalidates those rosters — a
5-slot team becomes over- or under-full against a shape nobody agreed to, and the
completeness check that gates materialization starts answering a different
question. A draft in flight is protected the same way (``roster_locked_by_draft``);
this is the missing half for teams.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from sqlalchemy import and_, select
from sqlalchemy.sql.elements import ColumnElement

from shared.core import http_status as status
from shared.core.errors import BaseAPIException
from shared.models.registration.registration import BalancerRegistrationTeam

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = (
    "assert_no_registered_teams",
    "has_registered_teams",
    "registered_team_status",
    "registered_team_tournament_ids",
    "teams_holding_slots_clause",
)

#: A disbanded or rejected team has released its slots and holds nothing; an
#: exported one is already materialized, so the shape it used is frozen into
#: ``tournament.player`` rows and changing the tournament's shape no longer
#: invalidates it. Only teams still holding slots block.
_RELEASED_TEAM_STATUSES = ("disbanded", "rejected")


async def registered_team_status(session: AsyncSession, tournament_id: int) -> str | None:
    """Status of a team still holding roster slots, or ``None`` if there is none.

    The single place this SELECT lives. The guard needs the status to name the
    blocker; the read-side flag only needs its presence — so callers wanting a
    boolean go through :func:`has_registered_teams`.
    """
    return await session.scalar(
        select(BalancerRegistrationTeam.status)
        .where(BalancerRegistrationTeam.tournament_id == tournament_id, teams_holding_slots_clause())
        .limit(1)
    )


def teams_holding_slots_clause() -> ColumnElement[bool]:
    """What "still holding roster slots" means, for differently scoped callers.

    ``roster_shape_guards`` asks it across every tournament of a workspace, so
    the three conditions live here once rather than per query.
    """
    return and_(
        BalancerRegistrationTeam.deleted_at.is_(None),
        BalancerRegistrationTeam.status.notin_(_RELEASED_TEAM_STATUSES),
        BalancerRegistrationTeam.exported_team_id.is_(None),
    )


async def has_registered_teams(session: AsyncSession, tournament_id: int) -> bool:
    """Whether any team still holds roster slots, i.e. whether the shape is locked."""
    return await registered_team_status(session, tournament_id) is not None


async def registered_team_tournament_ids(session: AsyncSession, tournament_ids: Sequence[int]) -> set[int]:
    """Tournament ids in ``tournament_ids`` whose registering teams still hold slots.

    One statement for a page of tournaments so list serialization does not pay
    one ``has_registered_teams`` round-trip per row.
    """
    if not tournament_ids:
        return set()
    result = await session.scalars(
        select(BalancerRegistrationTeam.tournament_id)
        .where(
            BalancerRegistrationTeam.tournament_id.in_(tournament_ids),
            teams_holding_slots_clause(),
        )
        .distinct()
    )
    return set(result.all())


async def assert_no_registered_teams(
    session: AsyncSession, tournament_id: int, *, change: str = "the roster shape"
) -> None:
    """Raise a business error when a registering team still holds roster slots."""
    active_status = await registered_team_status(session, tournament_id)
    if active_status is not None:
        raise BaseAPIException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot change {change} while teams are registered "
                f"(a team is currently '{active_status}'). Disband or reject them first."
            ),
        )
