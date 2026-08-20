"""Chronologically-correct "has this identity played before" resolution.

Replaces 3 independent, order-of-*import*-dependent computations
(balancer-service ``services/team.py``, parser-service ``services/team/flows.py``,
parser-service ``services/match_logs/flows.py``) that used "does a ``Player`` row
for this identity already exist in the DB right now" -- which freezes wrong the
moment historical data is imported out of chronological order.

Ordering matches the codebase's one established "tournament chronology"
convention (``division.py``/``streak.py``/``tournament/service.py``):
``Tournament.start_date NULLS LAST, Tournament.id``. Reproduced here as
``COALESCE(start_date, _FAR_FUTURE)`` because Postgres tuple comparison (``<``,
needed here -- not just ``ORDER BY``) breaks outright the moment either side is
NULL; ``NULLS LAST`` has no ``<``-comparison equivalent.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import HeroClass
from shared.models.tenancy.workspace import Workspace, WorkspaceMember
from shared.models.tournament.team import Player
from shared.models.tournament.tournament import Tournament

__all__ = ("NewcomerScope", "PriorParticipation", "load_prior_participation")

NewcomerScope = Literal["global", "workspace"]

# Stands in for a NULL `start_date` on both sides of the comparison -- the same
# role `NULLS LAST` plays in every `ORDER BY` elsewhere in the codebase, just
# usable in a `<` predicate.
_FAR_FUTURE = datetime(9999, 12, 31, 23, 59, 59, 999999, tzinfo=UTC)


@dataclass(frozen=True)
class PriorParticipation:
    """Identities (and identity+role pairs) with an earlier ``Player`` row than
    the tournament this was resolved for."""

    experienced_user_ids: frozenset[int]
    experienced_user_roles: frozenset[tuple[int, HeroClass | None]]

    def is_newcomer(self, user_id: int) -> bool:
        return user_id not in self.experienced_user_ids

    def is_newcomer_role(self, user_id: int, role: HeroClass | None) -> bool:
        return (user_id, role) not in self.experienced_user_roles


async def load_prior_participation(
    session: AsyncSession,
    *,
    tournament: Tournament,
    user_ids: Collection[int],
) -> PriorParticipation:
    """Batch-resolve prior participation for ``user_ids`` relative to ``tournament``.

    Reads ``tournament.workspace_id``'s ``newcomer_scope`` directly (not via the
    ``tournament.workspace`` relationship, which may not be loaded in an async
    context) to decide whether other workspaces' tournaments count.
    """
    if not user_ids:
        return PriorParticipation(frozenset(), frozenset())

    scope_row = await session.execute(
        sa.select(Workspace.newcomer_scope).where(Workspace.id == tournament.workspace_id)
    )
    scope: NewcomerScope = scope_row.scalar_one_or_none() or "global"

    cur_start = tournament.start_date or _FAR_FUTURE
    query = (
        sa.select(WorkspaceMember.player_id, Player.role)
        .select_from(Player)
        .join(WorkspaceMember, WorkspaceMember.id == Player.workspace_member_id)
        .join(Tournament, Tournament.id == Player.tournament_id)
        .where(
            WorkspaceMember.player_id.in_(user_ids),
            sa.tuple_(sa.func.coalesce(Tournament.start_date, _FAR_FUTURE), Tournament.id) < (cur_start, tournament.id),
        )
    )
    if scope == "workspace":
        query = query.where(Tournament.workspace_id == tournament.workspace_id)

    rows = (await session.execute(query)).all()
    experienced_user_ids = frozenset(user_id for user_id, _ in rows)
    experienced_user_roles = frozenset((user_id, role) for user_id, role in rows)
    return PriorParticipation(experienced_user_ids, experienced_user_roles)
