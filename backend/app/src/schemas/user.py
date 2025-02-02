import typing

from pydantic import BaseModel

from src import schemas
from src.core import enums

__all__ = (
    "UserProfile",
    "UserRole",
    "UserTournamentWithStats",
    "UserTournament",
    "MatchReadWithUserStats",
    "EncounterReadWithUserStats",
    "UserMap",
    "UserTournamentStat",
    "HeroStat",
    "HeroWithUserStats",
    "HeroStatBest",
    "UserBestTeammate",
)

from src.schemas import MapRead


class UserRole(BaseModel):
    role: enums.HeroClass
    tournaments: int
    maps_won: int
    maps: int
    division: int


class MatchReadWithUserStats(schemas.MatchRead):
    performance: int | None
    heroes: list[schemas.HeroRead]


class EncounterReadWithUserStats(schemas.EncounterRead):
    matches: list[MatchReadWithUserStats]


class UserTournament(BaseModel):
    id: int
    number: int | None
    name: str
    is_league: bool
    team_id: int
    team: str
    players: list["schemas.PlayerRead"]
    closeness: float
    placement: int | None
    count_teams: int
    won: int
    lost: int
    draw: int
    maps_won: int
    maps_lost: int
    role: enums.HeroClass
    division: int
    encounters: list[EncounterReadWithUserStats]


class UserTournamentStat(BaseModel):
    value: float
    rank: int
    total: int


class UserTournamentWithStats(BaseModel):
    id: int
    number: int | None
    name: str
    division: int
    closeness: float
    role: enums.HeroClass
    group_placement: float | None
    playoff_placement: float | None
    maps_won: int
    maps: int
    playtime: float

    stats: dict[enums.LogStatsName | typing.Literal["winrate"], UserTournamentStat]


class UserMap(BaseModel):
    map: MapRead
    count: int
    win: int
    loss: int
    draw: int
    win_rate: float
    heroes: list[schemas.HeroPlaytime]


class UserProfile(BaseModel):
    tournaments_count: int
    tournaments_won: int
    maps_total: int
    maps_won: int
    avg_closeness: float | None
    avg_placement: float | None
    avg_playoff_placement: float | None
    avg_group_placement: float | None
    most_played_hero: schemas.HeroRead | None

    roles: list[UserRole]
    tournaments: list[schemas.TournamentRead]
    hero_statistics: list[schemas.HeroPlaytime]


class HeroStatBest(BaseModel):
    encounter_id: int
    tournament_name: str
    map_name: str
    map_image_path: str
    value: float
    player_name: str


class HeroStat(BaseModel):
    name: enums.LogStatsName
    overall: float
    best: HeroStatBest
    avg_10: float
    best_all: HeroStatBest | None
    avg_10_all: float


class HeroWithUserStats(BaseModel):
    hero: schemas.HeroRead
    stats: list[HeroStat]


class UserBestTeammate(BaseModel):
    user: schemas.UserRead
    tournaments: int
    winrate: float
    stats: dict[enums.LogStatsName, float | None]
