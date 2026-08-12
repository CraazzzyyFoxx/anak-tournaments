import typing
from dataclasses import dataclass

from pydantic import BaseModel, Field

from shared.core import enums
from src.core import pagination

__all__ = (
    "HeroCreate",
    "HeroUpdate",
    "HeroListQueryParams",
    "HeroListParams",
)

# A hero's class, never ``HeroClass.flex``: flex is a roster role a player holds,
# not something a hero can be. ``overwatch.hero.type`` shares the ``heroclass``
# Postgres type with ``tournament.player.role``, so nothing but this narrowing
# (and the CHECK added in migration ``heroflex0001``) keeps an admin from typing
# a hero as flex and poisoning ``dominant_roles``, the stat baselines and impact
# scoring, all of which key off ``hero.type``.
HeroRole = enums.HeroTypeClass


class HeroCreate(BaseModel):
    """Schema for creating a hero"""

    name: str
    role: HeroRole
    color: str | None = None
    image_path: str | None = None


class HeroUpdate(BaseModel):
    """Schema for updating a hero"""

    name: str | None = None
    role: HeroRole | None = None
    color: str | None = None
    image_path: str | None = None


class HeroListQueryParams(
    pagination.PaginationSortQueryParams[typing.Literal["id", "name", "role", "created_at", "updated_at"]]
):
    per_page: int = Field(default=50, ge=-1, le=500)
    sort: typing.Literal["id", "name", "role", "created_at", "updated_at"] = "id"
    search: str | None = None
    role: HeroRole | None = None


@dataclass
class HeroListParams(pagination.PaginationSortParams):
    per_page: int = 50
    search: str | None = None
    role: HeroRole | None = None
