from datetime import datetime

from pydantic import BaseModel

__all__ = ("AnalyticsMatch", "AnalyticsTeam")


class AnalyticsTeam(BaseModel):
    team_id: int
    name: str
    players: list[str]
    score: float
    placement: int


class AnalyticsMatch(BaseModel):
    tournament_id: int
    #: Every live seat of the encounter, in slot order.
    teams: list[AnalyticsTeam]
    time: datetime
