import typing
from dataclasses import dataclass

from pydantic import BaseModel

from src.core import enums, pagination
from src.schemas import BaseRead

__all__ = (
    "OverfastHero",
    "HeroRead",
    "HeroPlaytime",
    "HeroPlaytimeQueryPaginationParams",
    "HeroPlaytimePaginationParams",
    "HeroStatsPaginationParams",
    "HeroStatsQueryPaginationParams",
)


class OverfastHero(BaseModel):
    key: str
    name: str
    portrait: str
    role: str


class HeroRead(BaseRead):
    slug: str
    name: str
    image_path: str
    type: str
    color: str


class HeroPlaytime(BaseModel):
    hero: HeroRead
    playtime: float


class HeroPlaytimeQueryPaginationParams(pagination.PaginationQueryParams):
    user_id: int | typing.Literal["all"] = "all"
    tournament_id: int | None = None


@dataclass
class HeroPlaytimePaginationParams(pagination.PaginationParams):
    user_id: int | typing.Literal["all"] = "all"
    tournament_id: int | None = None


class HeroStatsQueryPaginationParams(pagination.PaginationQueryParams):
    user_id: int | typing.Literal["all"] = "all"
    group_by: typing.Literal["overall", "match"] = "overall"
    stat: enums.LogStatsName = enums.LogStatsName.KDA


@dataclass
class HeroStatsPaginationParams(pagination.PaginationParams):
    user_id: int | typing.Literal["all"] = "all"
    group_by: typing.Literal["overall", "match"] = "overall"
    stat: enums.LogStatsName = enums.LogStatsName.HeroTimePlayed
