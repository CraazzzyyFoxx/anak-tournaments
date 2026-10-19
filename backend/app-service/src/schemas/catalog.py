"""Public catalog payloads: the shared native entity read, the legacy-id resolution and the character statistics
shapes (playtime shares and the per-character leaderboard)."""

from pydantic import BaseModel

from shared.schemas.catalog import (
    CatalogEntityRead,
    CharacterLeaderboardEntry,
    CharacterLeaderboardParams,
    CharacterLeaderboardQueryParams,
    CharacterPlaytime,
    CharacterPlaytimePaginationParams,
    CharacterPlaytimeQueryPaginationParams,
)

__all__ = (
    "CatalogEntityRead",
    "CatalogLegacyRead",
    "CharacterLeaderboardEntry",
    "CharacterLeaderboardParams",
    "CharacterLeaderboardQueryParams",
    "CharacterPlaytime",
    "CharacterPlaytimePaginationParams",
    "CharacterPlaytimeQueryPaginationParams",
)


class CatalogLegacyRead(BaseModel):
    """What an old ``overwatch.hero|map|gamemode`` id became (D84)."""

    entity_id: int
    discipline: str
    kind: str
    slug: str
