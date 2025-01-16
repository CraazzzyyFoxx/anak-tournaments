from dataclasses import dataclass

import sqlalchemy as sa

from src.core import db, pagination
from src.schemas import (
    BaseRead,
    MapRead,
    Score,
    TeamRead,
    TeamWithMatchStats,
    TournamentGroupRead,
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


class MatchReadWithStats(MatchRead):
    rounds: int
    home_team: TeamWithMatchStats
    away_team: TeamWithMatchStats


@dataclass
class EncounterSearchParams(pagination.SearchPaginationParams):
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


class EncounterSearchQueryParams(pagination.SearchQueryParams):
    tournament_id: int | None = None


@dataclass
class MatchSearchParams(pagination.SearchPaginationParams):
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


class MatchSearchQueryParams(pagination.SearchQueryParams):
    tournament_id: int | None = None
    home_team_id: int | None = None
    away_team_id: int | None = None
