"""Schemas for the platform audit-log read surface.

The journal is append-only and write-side-owned (``shared.services.audit``), so
there is no create/update model here — only the row shape the admin feed renders
and the filter set it is allowed to ask for.

The filter set is the admin one-search-input style plus three narrowing
filters the dashboard activity feed needs: ``since`` (a time window),
``exclude_actor_user_id`` (hide my own actions) and ``source`` (staff channels
only). Sorting still serves dates in the full feed.
"""

import typing
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from shared.core import pagination
from shared.core.pagination import SortOrder
from shared.services.audit import AuditSource
from src.schemas import BaseRead

__all__ = (
    "AuditLogRead",
    "AuditLogListQueryParams",
    "AuditLogListParams",
    "AUDIT_SORT_FIELDS",
    "AUDIT_SEARCH_FIELDS",
    "AUDIT_SOURCES",
)

# Sortable columns. Narrow on purpose: every one of these is a heap sort except
# ``created_at``/``id``, and the table has exactly one composite index per read
# shape (see AuditLog.__table_args__). These six are the columns the feed
# renders; anything else is a 422 from the query model rather than a silent
# fallback, so a typo in the UI surfaces instead of quietly reordering the page.
AuditSortField = typing.Literal["created_at", "id", "action", "source", "actor_label", "entity_type"]
AUDIT_SORT_FIELDS: tuple[str, ...] = typing.get_args(AuditSortField)

# `search` covers the four short text columns a human types into: who, what,
# which thing, and where it came from. `before_json`/`after_json` are excluded —
# they can hold email addresses, and an ILIKE over JSONB would turn the search
# box into a scan of every recorded value.
AUDIT_SEARCH_FIELDS: tuple[str, ...] = ("actor_label", "entity_label", "action", "source")

AUDIT_SOURCES: frozenset[str] = frozenset(typing.get_args(AuditSource))


class AuditLogRead(BaseRead):
    """One audit row, verbatim: every column the model stores.

    ``actor_label`` is a snapshot taken at write time so the row stays readable
    after the account is gone; the handler backfills it from the auth user when
    the snapshot is null, which is why it is optional here rather than required.
    """

    created_at: datetime
    # NULL = platform-level event (game catalog, global settings, global roles).
    # Only a superuser ever sees such a row.
    workspace_id: int | None = None
    # NULL = machine actor (scheduler, Challonge import), not "unknown human".
    actor_auth_user_id: int | None = None
    actor_label: str | None = None
    source: str
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    entity_label: str | None = None
    before_json: dict[str, Any] | None = None
    after_json: dict[str, Any] | None = None
    reason: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    correlation_id: str | None = None


class AuditLogListQueryParams(pagination.PaginationSortQueryParams[AuditSortField]):
    """Query string of ``GET /api/v1/admin/audit``.

    Defaults are ``created_at`` descending: the feed answers "what just
    happened", and ``created_at`` — not ``id`` — is the time order, because
    ``func.now()`` stamps the transaction's start.
    """

    per_page: int = Field(default=25, ge=-1, le=200)
    sort: AuditSortField = "created_at"
    order: SortOrder = SortOrder.DESC

    # Required for anyone but a superuser — enforced in the handler, not here,
    # because "which workspace" is an authorization question and the answer
    # depends on the caller, not on the query string.
    workspace_id: int | None = None
    entity_type: str | None = Field(default=None, max_length=64)
    entity_id: int | None = None
    action: str | None = Field(default=None, max_length=64)
    actor_user_id: int | None = None
    search: str | None = Field(default=None, max_length=255)
    since: datetime | None = Field(default=None, description="Only rows with created_at >= since.")
    exclude_actor_user_id: int | None = Field(
        default=None,
        description="Hide rows by this actor; machine rows (NULL actor) are kept.",
    )
    source: str | None = Field(
        default=None,
        max_length=255,
        description="Comma-separated audit sources to keep, e.g. `admin,api_key,discord,challonge`.",
    )

    @field_validator("source")
    @classmethod
    def _known_sources(cls, value: str | None) -> str | None:
        """Normalize to a clean comma list; an unknown source is a 422, blank is no filter."""
        if value is None:
            return None
        sources = [part.strip() for part in value.split(",") if part.strip()]
        unknown = sorted(set(sources) - AUDIT_SOURCES)
        if unknown:
            raise ValueError(f"unknown audit source: {', '.join(unknown)}")
        return ",".join(sources) or None


@dataclass
class AuditLogListParams(pagination.PaginationSortParams):
    per_page: int = 25
    sort: str = "created_at"
    order: SortOrder | typing.Literal["asc", "desc"] = SortOrder.DESC
    workspace_id: int | None = None
    entity_type: str | None = None
    entity_id: int | None = None
    action: str | None = None
    actor_user_id: int | None = None
    search: str | None = None
    since: datetime | None = None
    exclude_actor_user_id: int | None = None
    # Already validated and normalized by the query model: comma-joined AuditSource values.
    source: str | None = None

    @property
    def descending(self) -> bool:
        return self.order in (SortOrder.DESC, "desc")
