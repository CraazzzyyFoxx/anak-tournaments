"""Public catalog payloads: the shared native entity read and the character statistics shapes (playtime shares and
the per-character leaderboard)."""

from pydantic import Field

from shared.core import pagination
from shared.schemas.catalog import (
    CatalogEntityRead,
    CharacterLeaderboardEntry,
    CharacterLeaderboardParams,
    CharacterLeaderboardQueryParams,
    CharacterPlaytime,
    CharacterPlaytimePaginationParams,
    CharacterPlaytimeQueryPaginationParams,
)
from src.schemas.division_grid import DivisionGridVersionRead

__all__ = (
    "CatalogEntityRead",
    "CharacterLeaderboardEntry",
    "CharacterLeaderboardParams",
    "CharacterLeaderboardQueryParams",
    "CharacterLeaderboardResponse",
    "CharacterPlaytime",
    "CharacterPlaytimePaginationParams",
    "CharacterPlaytimeQueryPaginationParams",
)


class CharacterLeaderboardResponse(pagination.Paginated[CharacterLeaderboardEntry]):
    """One character's leaderboard page plus every stored division grid its rows' ``div`` refers to (none in the
    all-workspaces read, whose ``div`` is on the game's native ladder)."""

    division_grids: list[DivisionGridVersionRead] = Field(default_factory=list)
