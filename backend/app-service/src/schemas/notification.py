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
    "NotificationDelete",
    "NotificationDeleteResult",
    "NotificationAdminItem",
    "NotificationAdminPage",
    "NotificationRetire",
    "NotificationRetireResult",
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
    # Whether *this* caller has a read mark on the row -- the inbox page
    # computes it per identity (``NotificationRepository.page``). Defaults to
    # ``False`` for the banner read, which by construction only ever serves
    # rows the viewer has not dismissed.
    is_read: bool = False


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


class NotificationDelete(BaseModel):
    """``ids=None`` deletes the whole visible inbox; ``only_read`` narrows it.

    The two together are the "clear read" button, which must not be able to
    swallow a notification the user has not opened yet.
    """

    ids: list[int] | None = None
    only_read: bool = False


class NotificationDeleteResult(BaseModel):
    # ``deleted`` counts the rows that actually left this inbox: ids outside
    # the caller's audience contribute nothing, and a repeat call deletes
    # nothing at all.
    deleted: int
    unread_count: int


class NotificationAdminItem(BaseRead):
    """One produced row as an operator sees it.

    Separate from ``NotificationItem`` because it answers a different question:
    the inbox model is "what am I being told", this one is "what did my
    workspace send, to whom, and is it still live". Hence ``recipient`` — which
    the inbox has no business carrying, since there it is always the caller —
    and no ``is_read``, which is a fact about a viewer this screen does not have.
    """

    model_config = ConfigDict(from_attributes=True)

    kind: str
    payload: dict[str, Any] = Field(validation_alias="payload_json")
    recipient_auth_user_id: int | None = None
    #: The recipient's current username, LEFT-joined at read time -- ``None``
    #: when the audience is not a single user, or the account is gone.
    recipient_username: str | None = None
    source_workspace_id: int | None = None
    published_at: datetime
    #: Set (and in the past) means retired: the row no longer reaches an inbox.
    expires_at: datetime | None = None


class NotificationAdminPage(BaseModel):
    items: list[NotificationAdminItem]
    #: ``None`` on the last page; opaque, like the inbox cursor.
    next_cursor: str | None = None


class NotificationRetire(BaseModel):
    """Which of this workspace's notifications to take out of circulation.

    ``ids`` and ``kind`` are filters over the same scoped statement and may be
    combined. Naming neither is rejected — "retire everything this workspace
    ever sent" must be spelled out one kind at a time, not reached by omission.
    """

    model_config = ConfigDict(extra="forbid")

    workspace_id: int
    ids: list[int] | None = None
    kind: str | None = None


class NotificationRetireResult(BaseModel):
    #: Rows that were live and now are not; a repeat call answers 0.
    retired: int
