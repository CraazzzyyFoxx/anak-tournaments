from pydantic import BaseModel

from shared.schemas.catalog import (
    HeroLeaderboardEntry,
    HeroLeaderboardParams,
    HeroLeaderboardQueryParams,
    HeroPlaytime,
    HeroPlaytimePaginationParams,
    HeroPlaytimeQueryPaginationParams,
    HeroRead,
    HeroStatsPaginationParams,
    HeroStatsQueryPaginationParams,
)

__all__ = (
    "OverfastHero",
    "HeroRead",
    "HeroPlaytime",
    "HeroPlaytimeQueryPaginationParams",
    "HeroPlaytimePaginationParams",
    "HeroStatsPaginationParams",
    "HeroStatsQueryPaginationParams",
    "HeroLeaderboardEntry",
    "HeroLeaderboardQueryParams",
    "HeroLeaderboardParams",
)


class OverfastHero(BaseModel):
    key: str
    name: str
    portrait: str
    role: str
