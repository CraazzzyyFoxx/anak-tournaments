"""Team materialization: the single writer of tournament teams/players.

``team_materialization`` owns the destructive export sequence
(cleanup -> insert -> backfill -> stamp -> one commit).
"""

from src.services.team_export.identity import refuse_missing_handles
from src.services.team_export.materialization import (
    MaterializationMember,
    MaterializationResult,
    MaterializationTeam,
)
from src.services.team_export.ranks import sync_player_ranks
from src.services.team_export.service import ExportOutcome, ExportPlan, team_materialization

__all__ = (
    "ExportOutcome",
    "ExportPlan",
    "MaterializationMember",
    "MaterializationResult",
    "MaterializationTeam",
    "refuse_missing_handles",
    "sync_player_ranks",
    "team_materialization",
)
