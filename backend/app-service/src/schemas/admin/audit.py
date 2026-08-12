"""Schemas for the platform audit-log read surface.

The journal is append-only and write-side-owned (``shared.services.audit``), so
there is no create/update model here — only the row shape the admin feed renders
and the filter set it is allowed to ask for.

The filter set is deliberately five values plus pagination, not the eleven an
audit feed invites. The admin house style is one search input with an optional
second control on the same row; no other admin table carries a date range, and
adding one here would have been the only such control in the panel. Dates are
served by sorting, and ``source`` is served by ``search``.
"""

import typing
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import Field

from shared.core.pagination import SortOrder
from src.core import pagination
from src.schemas import BaseRead

__all__ = (
    "AuditLogRead",
    "AuditLogListQueryParams",
    "AuditLogListParams",
    "AUDIT_SORT_FIELDS",
    "AUDIT_SEARCH_FIELDS",
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

    @property
    def descending(self) -> bool:
        return self.order in (SortOrder.DESC, "desc")
