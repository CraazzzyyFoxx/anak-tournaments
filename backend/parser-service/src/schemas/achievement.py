import typing

from pydantic import BaseModel

__all__ = (
    "AchievementCreate",
    "AchievementFunction",
    "AchievementCalculateRequest",
    "AchievementCalculateResponse",
)



class AchievementCreate(BaseModel):
    name: str
    slug: str
    description_ru: str
    description_en: str


class AchievementFunction(BaseModel):
    slug: str
    tournament_required: bool
    function: typing.Callable


class AchievementCalculateRequest(BaseModel):
    slugs: list[str] | None = None
    ensure_created: bool = True


class AchievementCalculateResponse(BaseModel):
    tournament_id: int | None
    executed: list[str]
    message: str
