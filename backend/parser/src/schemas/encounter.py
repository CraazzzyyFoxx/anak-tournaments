from src.schemas import (
    BaseRead,
    TournamentRead,
    TournamentGroupRead,
    TeamRead,
    MapRead,
    Score,
)


__all__ = ("EncounterRead", "MatchRead")


class EncounterRead(BaseRead):
    name: str
    home_team_id: int
    away_team_id: int
    score: Score
    round: int
    tournament_id: int
    tournament_group_id: int | None
    challonge_id: int | None
    closeness: float | None
    has_logs: bool

    tournament_group: TournamentGroupRead | None
    tournament: TournamentRead | None
    home_team: TeamRead | None
    away_team: TeamRead | None
    matches: list["MatchRead"]


class MatchRead(BaseRead):
    home_team_id: int
    away_team_id: int
    score: Score
    time: float
    log_name: str

    encounter_id: int
    map_id: int

    home_team: TeamRead | None
    away_team: TeamRead | None
    encounter: EncounterRead | None
    map: MapRead | None
