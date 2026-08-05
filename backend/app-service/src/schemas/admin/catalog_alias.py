"""Schemas for the catalog alias-miss queue (superuser admin surface).

A miss is a hero/map/gamemode name a match log used that neither the canonical
`name` nor any `aliases` entry resolved. The queue is what the admin works
through: pick the entity the raw name meant and attach it, or dismiss it.

`CatalogAliasAttach` is a dedicated write instead of `PATCH aliases=[...]` from
the browser: appending an alias client-side is a read-modify-write that two
admins editing the same entity would race, and attaching must close the matching
miss row in the same transaction.
"""

import typing
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from shared.core import enums
from src.core import pagination
from src.schemas import BaseRead

__all__ = (
    "CatalogAliasMissRead",
    "CatalogAliasMissListQueryParams",
    "CatalogAliasMissListParams",
    "CatalogAliasAttach",
)

# Mirrors `CatalogAliasMiss.raw_name` (String(128)) — a longer name could not be
# stored, and could therefore never have produced a miss row to attach to.
ALIAS_MAX_LENGTH = 128


class CatalogAliasMissRead(BaseRead):
    """One unresolved catalog name, with how often logs have hit it."""

    entity_type: enums.CatalogEntityType
    raw_name: str
    occurrences: int
    first_seen_at: datetime
    last_seen_at: datetime
    last_log_record_id: int | None = None
    # Joined from `log_processing.record`, not stored: a log record is only
    # addressable in the admin UI as /admin/tournaments/{id}/matches/logs.
    last_log_tournament_id: int | None = None
    resolved_at: datetime | None = None


class CatalogAliasMissListQueryParams(
    pagination.PaginationSortQueryParams[typing.Literal["id", "occurrences", "first_seen_at", "last_seen_at"]]
):
    per_page: int = Field(default=50, ge=-1, le=500)
    # `sort`/`order` are inherited but unused: the queue is always ordered by how
    # much the missing alias hurts (occurrences, then recency).
    sort: typing.Literal["id", "occurrences", "first_seen_at", "last_seen_at"] = "occurrences"
    entity_type: enums.CatalogEntityType | None = None
    include_resolved: bool = False


@dataclass
class CatalogAliasMissListParams(pagination.PaginationSortParams):
    per_page: int = 50
    entity_type: enums.CatalogEntityType | None = None
    include_resolved: bool = False


class CatalogAliasAttach(BaseModel):
    """Attach `alias` to one catalog entity and close the matching miss."""

    entity_type: enums.CatalogEntityType
    entity_id: int
    alias: str = Field(min_length=1, max_length=ALIAS_MAX_LENGTH)

    @field_validator("alias")
    @classmethod
    def _strip_alias(cls, value: str) -> str:
        """Strip here so the handler never has to: a blank alias would attach
        nothing yet still report success."""
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("alias must not be blank")
        return cleaned
