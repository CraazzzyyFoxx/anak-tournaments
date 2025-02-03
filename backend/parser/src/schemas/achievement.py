import typing

from pydantic import BaseModel


__all__ = ("AchievementCreate", "AchievementFunction")


class AchievementCreate(BaseModel):
    name: str
    slug: str
    description_ru: str
    description_en: str


class AchievementFunction(BaseModel):
    slug: str
    tournament_required: bool
    function: typing.Callable
