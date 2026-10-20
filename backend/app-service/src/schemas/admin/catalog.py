"""Admin CRUD for ``catalog.entity``: one surface for every discipline and kind."""

import json
import typing
from dataclasses import dataclass

from pydantic import BaseModel, Field, field_validator

from src.core import pagination

__all__ = (
    "CatalogEntityCreate",
    "CatalogEntityListParams",
    "CatalogEntityListQueryParams",
    "CatalogEntityUpdate",
)

_SORT = typing.Literal["id", "name", "slug", "parent_id", "created_at", "updated_at"]


class CatalogEntityCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    #: Derived from ``name`` (``shared.catalog_aliases.slugify``) when omitted.
    slug: str | None = Field(default=None, min_length=1, max_length=64)
    image_path: str | None = None
    #: A map's mode; required for a map of a discipline that has modes, refused otherwise.
    parent_id: int | None = None
    #: ``class`` for a character (checked against the module's classes), ``color``, ``in_competitive``, ``description``…
    attrs: dict[str, typing.Any] = Field(default_factory=dict)
    aliases: list[str] = Field(default_factory=list)
    active: bool = True


class CatalogEntityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    slug: str | None = Field(default=None, min_length=1, max_length=64)
    image_path: str | None = None
    parent_id: int | None = None
    #: Shallow merge: present keys replace, absent keys keep.
    attrs: dict[str, typing.Any] | None = None
    aliases: list[str] | None = None
    active: bool | None = None

    @field_validator("name", "slug", "attrs", "active", mode="before")
    @classmethod
    def _non_null_when_present(cls, value: typing.Any) -> typing.Any:
        if value is None:
            raise ValueError("must not be null")
        return value


class CatalogEntityListQueryParams(pagination.PaginationSortQueryParams[_SORT]):
    per_page: int = Field(default=50, ge=-1, le=500)
    sort: _SORT = "id"
    search: str | None = None
    parent_id: int | None = None
    #: A JSON object; rows whose ``attrs`` contain it (``{"class": "tank"}``, ``{"in_competitive": false}``).
    attrs: str | None = None
    active: bool | None = None

    @field_validator("attrs")
    @classmethod
    def _attrs_is_an_object(cls, value: str | None) -> str | None:
        if value is not None and not isinstance(json.loads(value), dict):
            raise ValueError("attrs must be a JSON object")
        return value


@dataclass
class CatalogEntityListParams(pagination.PaginationSortParams):
    per_page: int = 50
    search: str | None = None
    parent_id: int | None = None
    attrs: str | None = None
    active: bool | None = None
