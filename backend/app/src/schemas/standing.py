from pydantic import BaseModel

from src.schemas import (
    BaseRead,
    EncounterRead,
    TeamRead,
    TournamentGroupRead,
    TournamentRead,
)

__all__ = (
    "StandingTeamData",
    "StandingTeamDataWithBuchholzTB",
    "StandingTeamDataWithRanking",
    "StandingRead",
)


class StandingTeamData(BaseModel):
    id: int
    wins: int
    draws: int
    loses: int
    points: float
    opponents: list[int]
    matches: int


class StandingTeamDataWithBuchholzTB(StandingTeamData):
    buchholz: float
    tb: int


class StandingTeamDataWithRanking(StandingTeamData):
    ranking: int | float


class StandingRead(BaseRead):
    tournament_id: int
    group_id: int
    team_id: int
    position: int
    overall_position: int
    matches: int
    win: int
    draw: int
    lose: int
    points: float
    buchholz: float | None
    tb: int | None

    team: TeamRead | None
    group: TournamentGroupRead | None
    tournament: TournamentRead | None
    matches_history: list[EncounterRead]
