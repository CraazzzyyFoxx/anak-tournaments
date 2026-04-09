import typing
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, Field

from src.core import pagination

__all__ = (
    "AchievementAdminRead",
    "AchievementAdminCreate",
    "AchievementAdminUpdate",
    "AchievementListQueryParams",
    "AchievementListParams",
    "AchievementRegistryEntry",
    "AchievementRegistryResponse",
)


class AchievementAdminRead(BaseModel):
    id: int
    name: str
    slug: str
    description_ru: str
    description_en: str
    image_url: str | None
    hero_id: int | None
    created_at: datetime
    updated_at: datetime | None


class AchievementAdminCreate(BaseModel):
    name: str
    slug: str
    description_ru: str
    description_en: str
    image_url: str | None = None
    hero_id: int | None = None


class AchievementAdminUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    description_ru: str | None = None
    description_en: str | None = None
    image_url: str | None = None
    hero_id: int | None = None


class AchievementListQueryParams(
    pagination.PaginationSortQueryParams[
        typing.Literal["id", "name", "slug", "created_at", "updated_at"]
    ]
):
    per_page: int = Field(default=50, ge=-1, le=500)
    sort: typing.Literal["id", "name", "slug", "created_at", "updated_at"] = "id"
    search: str | None = None


@dataclass
class AchievementListParams(pagination.PaginationSortParams):
    per_page: int = 50
    search: str | None = None


class AchievementRegistryEntry(BaseModel):
    slug: str
    category: str
    tournament_required: bool


class AchievementRegistryResponse(BaseModel):
    entries: list[AchievementRegistryEntry]
