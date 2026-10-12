from pydantic import BaseModel

from src.schemas.base import BaseRead, Score
from src.schemas.map import MapRead
from src.schemas.stage import StageItemRead, StageRead
from src.schemas.team import TeamRead
from src.schemas.tournament import TournamentRead

__all__ = ("EncounterRead", "EncounterTeamRead", "MatchRead")


class EncounterTeamRead(BaseModel):
    """One live seat of an encounter (``encounter.team``); ``id`` is the participation id."""

    id: int
    slot: int
    team_id: int | None = None
    name: str
    score: float = 0.0
    placement: int | None = None
    team: TeamRead | None = None


class EncounterRead(BaseRead):
    name: str
    slot_count: int = 2
    round: int | None = None
    tournament_id: int
    stage_id: int | None = None
    stage_item_id: int | None = None
    status: str
    closeness: float | None
    has_logs: bool
    result_status: str = "none"

    stage: StageRead | None
    stage_item: StageItemRead | None
    tournament: TournamentRead | None
    teams: list[EncounterTeamRead] = []
    matches: list[MatchRead]


class MatchRead(BaseRead):
    home_team_id: int
    away_team_id: int
    score: Score
    time: float | None
    log_name: str | None
    source: str

    encounter_id: int
    map_id: int
    code: str | None = None

    home_team: TeamRead | None
    away_team: TeamRead | None
    encounter: EncounterRead | None
    map: MapRead | None
