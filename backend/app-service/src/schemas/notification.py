"""Read models for the notification inbox and the announcement banner.

``NotificationItem`` deliberately carries no rendered text for system kinds:
the row stores ``kind`` + a payload snapshot and the frontend renders
``t("notifications.kinds.<kind>", payload)``, so a translation fix reaches
rows that were written months ago. Announcements are the exception -- their
operator-written text lives *inside* the payload, one entry per locale.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.schemas.base import BaseRead

__all__ = (
    "NotificationItem",
    "NotificationInboxRead",
    "NotificationMarkRead",
    "NotificationMarkReadResult",
)


class NotificationItem(BaseRead):
    model_config = ConfigDict(from_attributes=True)

    audience: str
    kind: str
    # ``payload_json`` on the row; ``payload`` on the wire -- the column name's
    # ``_json`` suffix is a storage detail, and the frontend interpolates this
    # object into the kind's i18n message.
    payload: dict[str, Any] = Field(validation_alias="payload_json")
    workspace_id: int | None = None
    published_at: datetime
    expires_at: datetime | None = None


class NotificationInboxRead(BaseModel):
    """One inbox round trip: the page, the badge count and the continuation.

    The bell renders the count and the list together on every open, so serving
    them from two endpoints would double the requests for a header component
    that mounts on every page.
    """

    items: list[NotificationItem]
    unread_count: int
    # ``None`` means "this was the last page". Opaque: the pair it encodes is an
    # ordering detail, and a client that parses it starts depending on the sort key.
    next_cursor: str | None = None


class NotificationMarkRead(BaseModel):
    """``ids=None`` marks the whole visible inbox (the "mark all read" button)."""

    ids: list[int] | None = None


class NotificationMarkReadResult(BaseModel):
    # ``marked`` counts the rows that actually landed: ids outside the caller's
    # audience contribute nothing, and a repeat call marks nothing at all.
    marked: int
    unread_count: int
