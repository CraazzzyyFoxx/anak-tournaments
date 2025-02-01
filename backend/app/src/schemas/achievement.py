from .base import BaseRead

__all__ = (
    "AchievementRead",
    "UserAchievementRead",
)

from src.schemas import HeroRead, TournamentRead, MatchRead


class AchievementRead(BaseRead):
    name: str
    slug: str
    description_ru: str
    description_en: str
    hero_id: int | None
    rarity: float

    hero: HeroRead | None
    count: int | None


class UserAchievementRead(AchievementRead):
    count: int
    tournaments_ids: list[int]
    tournaments: list[TournamentRead]
    matches_ids: list[int]
    matches: list[MatchRead]
