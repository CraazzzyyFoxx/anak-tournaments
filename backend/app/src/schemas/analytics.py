from pydantic import BaseModel

from src.schemas import PlayerRead, TeamRead


__all__ = (
    "PlayerAnalytics",
    "TeamAnalytics",
    "TournamentAnalytics"
)


class PlayerAnalytics(PlayerRead):
    points: float
    move_1: float | None
    move_2: float | None


class TeamAnalytics(TeamRead):
    players: list[PlayerAnalytics]
    balancer_shift: int
    manual_shift: int
    total_shift: int


class TournamentAnalytics(BaseModel):
    teams: list[TeamAnalytics]
    teams_wins: dict[int, int]
