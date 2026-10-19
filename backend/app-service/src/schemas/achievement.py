import typing

from pydantic import BaseModel

from .base import BaseRead

__all__ = (
    "AchievementListQueryParams",
    "AchievementRead",
    "UserAchievementRead",
    "AchievementEarned",
    "AchievementTournamentLink",
    "AchievementMatchLink",
)

from shared.schemas.catalog import CatalogEntityRead
from shared.schemas.match import MatchParticipantRead
from src.core import pagination
from src.schemas import UserRead

ACHIEVEMENT_SORT = typing.Literal["id", "name", "slug", "rarity", "similarity:name", "similarity:slug"]


class AchievementListQueryParams(pagination.PaginationSortQueryParams[ACHIEVEMENT_SORT]):
    """The public achievement list: ``discipline`` narrows it to one game (absent: every game's rules)."""

    discipline: str | None = None


class AchievementRead(BaseRead):
    name: str
    slug: str
    description_ru: str
    description_en: str
    image_url: str | None
    discipline: str
    entity_id: int | None
    rarity: float

    category: str | None = None
    scope: str | None = None
    condition_tree: dict | None = None

    entity: CatalogEntityRead | None
    count: int | None


class AchievementTournamentLink(BaseModel):
    """Narrow tournament reference for achievement payloads."""

    id: int
    name: str
    is_league: bool


class AchievementMatchLink(BaseModel):
    """Narrow match reference for achievement payloads: the match and every participant, in slot order."""

    id: int
    encounter_id: int
    map_id: int
    log_name: str | None
    #: Seconds.
    duration_s: float | None
    participants: list[MatchParticipantRead]


class UserAchievementRead(AchievementRead):
    count: int
    tournaments_ids: list[int]
    tournaments: list[AchievementTournamentLink]
    matches_ids: list[int]
    matches: list[AchievementMatchLink]


class AchievementEarned(BaseModel):
    user: UserRead
    count: int
    last_tournament: AchievementTournamentLink | None
    last_match: AchievementMatchLink | None
