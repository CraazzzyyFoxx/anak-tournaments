from pydantic import BaseModel

from .base import BaseRead, Score

__all__ = (
    "AchievementRead",
    "UserAchievementRead",
    "AchievementEarned",
    "AchievementTournamentLink",
    "AchievementMatchLink",
    "AchievementMatchTeamRef",
)

from src.schemas import HeroRead, UserRead


class AchievementRead(BaseRead):
    name: str
    slug: str
    description_ru: str
    description_en: str
    image_url: str | None
    hero_id: int | None
    rarity: float

    category: str | None = None
    scope: str | None = None
    condition_tree: dict | None = None

    hero: HeroRead | None
    count: int | None


class AchievementTournamentLink(BaseModel):
    """Narrow tournament reference for achievement payloads."""

    id: int
    name: str
    is_league: bool


class AchievementMatchTeamRef(BaseModel):
    """Bare team reference for `AchievementMatchLink.{home,away}_team`."""

    id: int
    name: str
    image_url: str | None = None


class AchievementMatchLink(BaseModel):
    """Narrow match reference for achievement payloads."""

    id: int
    encounter_id: int
    map_id: int
    score: Score
    log_name: str | None
    time: float | None
    home_team: AchievementMatchTeamRef | None = None
    away_team: AchievementMatchTeamRef | None = None


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
