from pydantic import BaseModel

from src.schemas import PlayerRead, TeamRead, BaseRead

__all__ = (
    "PlayerAnalytics",
    "TeamAnalytics",
    "TournamentAnalytics",
    "AnalyticsAlgorithmRead",
)


class AnalyticsAlgorithmRead(BaseRead):
    name: str


class PlayerAnalytics(PlayerRead):
    points: float
    move_1: float | None
    move_2: float | None
    shift: float | None


class TeamAnalytics(TeamRead):
    players: list[PlayerAnalytics]
    balancer_shift: int
    manual_shift: int
    total_shift: int


class TournamentAnalytics(BaseModel):
    teams: list[TeamAnalytics]
    teams_wins: dict[int, int]
