"""balancer-service adapter onto the shared team materialization.

The writer itself now lives in :mod:`shared.services.team_export` — this module
only maps balancer-service's ``BalancerTeam`` wire payload onto the shared
``MaterializationTeam`` input, and offers the plain-import entry point used by the
admin teams-import RPC.

The export paths (``admin/balancer.py``, ``draft/export.py``) build their own
:class:`~shared.services.team_export.ExportPlan` because they also need the
destructive cleanup, the ``exported_team_id`` backfill and their own stamp.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared.services.team_export import (
    ExportOutcome,
    ExportPlan,
    MaterializationMember,
    MaterializationTeam,
    team_materialization,
)
from src.schemas.team import BalancerTeam

__all__ = ("import_teams", "to_materialization_teams")

logger = logging.getLogger(__name__)


def to_materialization_teams(payload: Sequence[BalancerTeam]) -> list[MaterializationTeam]:
    """``BalancerTeam`` -> shared writer input.

    ``BalancerTeam.name`` is both the stored ``balancer_name`` and, by
    convention, the captain's battle tag; each member's ``name`` is their own
    tag. Both stay implicit here exactly as they were in the writer this replaces.
    """
    return [
        MaterializationTeam(
            balancer_name=team.name,
            members=tuple(
                MaterializationMember(
                    name=member.name,
                    rank=member.rank,
                    slot_code=member.role,
                    sub_role=member.sub_role,
                )
                for member in team.members
            ),
        )
        for team in payload
    ]


async def import_teams(
    session: AsyncSession,
    tournament_id: int,
    payload: Sequence[BalancerTeam],
) -> ExportOutcome:
    """Plain import: create teams/players, no prior-export cleanup, no stamp.

    Commits once (the orchestrator owns the boundary), which is what the previous
    ``bulk_create_from_balancer`` did internally — callers that relied on that
    commit keep working unchanged.
    """
    return await team_materialization.run(
        session,
        ExportPlan(
            tournament_id=tournament_id,
            teams=to_materialization_teams(payload),
            # Lenient, as balancer-service has always been: an unresolvable
            # battle tag skips that player rather than failing the whole import.
            on_unresolved="skip",
        ),
    )
