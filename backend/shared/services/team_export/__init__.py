"""Shared team materialization: the single writer of tournament teams/players.

``materialize_teams`` replaces the two near-duplicate ``bulk_create_from_balancer``
implementations; ``team_materialization`` owns the destructive export sequence
(cleanup -> insert -> backfill -> stamp -> one commit) that its three callers used
to each carry a copy of.
"""

from shared.services.team_export.identity import find_users_by_battle_tags
from shared.services.team_export.materialization import (
    MaterializationMember,
    MaterializationResult,
    MaterializationTeam,
    OnUnresolved,
    materialize_teams,
    resolve_slot_role,
)
from shared.services.team_export.service import (
    ExportOutcome,
    ExportPlan,
    TeamMaterializationService,
    team_materialization,
)

__all__ = (
    "ExportOutcome",
    "ExportPlan",
    "MaterializationMember",
    "MaterializationResult",
    "MaterializationTeam",
    "OnUnresolved",
    "TeamMaterializationService",
    "find_users_by_battle_tags",
    "materialize_teams",
    "resolve_slot_role",
    "team_materialization",
)
