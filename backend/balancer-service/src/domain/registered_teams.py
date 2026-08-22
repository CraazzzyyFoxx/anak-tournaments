"""Result value object for registered-team export.

Moved out of ``services/registered_teams.py`` because it is a plain data
holder with zero I/O or async — a domain value object, not orchestration.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from shared.services.team_export.registered import SkippedTeam

__all__ = ("RegisteredExportResult",)


@dataclass
class RegisteredExportResult:
    removed_teams: int = 0
    imported_teams: int = 0
    created_players: int = 0
    skipped: list[SkippedTeam] = field(default_factory=list)
