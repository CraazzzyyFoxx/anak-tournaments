from pydantic import BaseModel

__all__ = (
    "TournamentStatistics",
    "DivisionStatistics",
    "PlayerStatistics",
    "OverallStatistics",
)


class TournamentStatistics(BaseModel):
    id: int
    number: int
    players_count: int
    avg_sr: float
    avg_closeness: float | None


class DivisionStatistics(BaseModel):
    id: int
    number: int
    tank_avg_div: float
    damage_avg_div: float
    support_avg_div: float


class PlayerStatistics(BaseModel):
    id: int
    name: str
    value: int | float


class OverallStatistics(BaseModel):
    tournaments: int
    teams: int
    players: int
    champions: int
