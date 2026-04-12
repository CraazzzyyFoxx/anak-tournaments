from dataclasses import dataclass

import sqlalchemy as sa

from src.core import db, pagination
from src.schemas import (
    BaseRead,
    MapRead,
    Score,
    StageItemRead,
    StageRead,
    TeamRead,
    TeamWithMatchStats,
    TournamentRead,
)

__all__ = (
    "EncounterRead",
    "MatchRead",
    "MatchReadWithStats",
    "EncounterSearchParams",
    "EncounterSearchQueryParams",
    "MatchSearchParams",
    "MatchSearchQueryParams",
)


class EncounterRead(BaseRead):
    name: str
    home_team_id: int
    away_team_id: int
    score: Score
    round: int
    best_of: int = 3
    tournament_id: int
    stage_id: int | None = None
    stage_item_id: int | None = None
    challonge_id: int | None
    closeness: float | None
    has_logs: bool
    status: str
    result_status: str = "none"

    stage: StageRead | None
    stage_item: StageItemRead | None
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


class MatchReadWithStats(MatchRead):
    rounds: int
    home_team: TeamWithMatchStats
    away_team: TeamWithMatchStats


@dataclass
class EncounterSearchParams(pagination.PaginationSortSearchParams):
    tournament_id: int | None = None

    def apply_search(self, query: sa.Select, model: type[db.Base]) -> sa.Select:
        criteria = []
        search_query = f"%{self.query}%"
        for field in self.fields:
            column = model.depth_get_column(field.split("."))
            criteria.append(column.ilike(search_query))
            if field == "name":
                reverted_name = sa.func.concat(
                    (sa.func.split_part(column, " vs ", 2)),
                    " vs ",
                    (sa.func.split_part(column, " vs ", 1)),
                )
                criteria.append(reverted_name.ilike(f"%{self.query}%"))
        return query.where(sa.or_(*criteria))


class EncounterSearchQueryParams(pagination.PaginationSortSearchQueryParams):
    tournament_id: int | None = None


@dataclass
class MatchSearchParams(pagination.PaginationSortSearchParams):
    tournament_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None

    def apply_search(self, query: sa.Select, model: type[db.Base]) -> sa.Select:
        criteria = []
        search_query = f"%{self.query}%"
        for field in self.fields:
            column = model.depth_get_column(field.split("."))
            criteria.append(column.ilike(search_query))
            if field == "log_name":
                criteria.append(sa.func.split_part(column, ".", 1).ilike(search_query))
        return query.where(sa.or_(*criteria))


class MatchSearchQueryParams(pagination.PaginationSortSearchQueryParams):
    tournament_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None
