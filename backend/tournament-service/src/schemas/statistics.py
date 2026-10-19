from pydantic import BaseModel

__all__ = (
    "TournamentStatistics",
    "DivisionStatistics",
    "PlayerStatistics",
    "OverallStatistics",
)


class TournamentStatistics(BaseModel):
    id: int
    name: str
    players_count: int
    avg_sr: float
    avg_closeness: float | None


class DivisionStatistics(BaseModel):
    id: int
    name: str
    #: Average division by top-level role code of the game's rated dimension; a role nobody played is absent.
    role_avg_divs: dict[str, float]


class PlayerStatistics(BaseModel):
    id: int
    name: str
    value: int | float


class OverallStatistics(BaseModel):
    tournaments: int
    teams: int
    players: int
    champions: int
    # Played volume. ``encounters`` counts finished (COMPLETED) ones only;
    # ``days`` is the distinct calendar days the tournaments cover, so a shared
    # weekend counts once; ``hours`` is whole hours of logged map time.
    encounters: int
    maps: int
    days: int
    hours: int
