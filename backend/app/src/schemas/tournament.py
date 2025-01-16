from datetime import datetime

from pydantic import BaseModel

from src.core import enums
from src.schemas import UserRead
from src.schemas.base import BaseRead

__all__ = (
    "TournamentRead",
    "TournamentGroupRead",
    "OwalStanding",
    "OwalStandingDay",
    "OwalStandings",
)


class TournamentGroupRead(BaseRead):
    name: str
    description: str | None
    is_groups: bool
    challonge_id: int | None
    challonge_slug: str | None


class TournamentRead(BaseRead):
    number: int | None
    name: str
    description: str | None
    challonge_id: int | None
    challonge_slug: str | None
    is_league: bool
    is_finished: bool
    start_date: datetime
    end_date: datetime

    groups: list[TournamentGroupRead]
    participants_count: int | None


class OwalStandingDay(BaseModel):
    team: str
    role: enums.HeroClass
    points: float
    wins: int
    draws: int
    losses: int
    win_rate: float


class OwalStanding(BaseModel):
    user: UserRead
    role: enums.HeroClass
    days: dict[int, OwalStandingDay]
    count_days: int
    place: int
    best_3_days: float
    avg_points: float
    wins: int
    draws: int
    losses: int
    win_rate: float


class OwalStandings(BaseModel):
    days: list[TournamentRead]
    standings: list[OwalStanding]
