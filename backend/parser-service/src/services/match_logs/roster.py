"""The player of a parsed log, as the statistics rows need them.

A log names people, not roster rows: a substitute is an encounter snapshot,
never a fabricated tournament roster row. Global ``user_id`` remains the pure
Overwatch scoring pivot key; persistence resolves it to a workspace member and
the game's encounter participation before constructing native observations.
"""

from __future__ import annotations

from dataclasses import dataclass

from src import models

__all__ = ("LogPlayer",)


@dataclass(frozen=True, slots=True)
class LogPlayer:
    user_id: int
    team_id: int
    name: str
    role: str | None
    rank: int
    sub_role: str | None = None

    @classmethod
    def from_roster(cls, player: models.Player) -> LogPlayer:
        """A ``tournament.player`` with its ``workspace_member`` loaded."""
        return cls(
            user_id=player.workspace_member.player_id,
            team_id=player.team_id,
            name=player.name,
            role=player.role,
            rank=player.rank,
            sub_role=player.sub_role,
        )
