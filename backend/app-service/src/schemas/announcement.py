"""Write models for the operator-facing announcement CRUD.

Deliberately thin: the announcement's own shape -- which locales are required,
which ``default_locale`` is legal, what an ``href`` may point at -- lives in
``shared.services.notifications.AnnouncementPayload`` and is enforced by
``validate_notification_payload``, because ``notify()`` enforces the same rules
for every other writer. Re-declaring the fields here with their own constraints
would be a second copy that drifts, so these models only carry what the RPC
boundary itself decides: which audience is reachable through this surface, and
which fields an edit is allowed to touch.

The read side is ``schemas.NotificationItem`` -- an announcement is a
notification row, and the operator list shows exactly what the inbox stores.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

__all__ = ("AnnouncementCreate", "AnnouncementUpdate")

# ``user`` is missing on purpose: personal notifications are written by the
# domain flows that cause them, from server-resolved recipients. Accepting it
# here would mean a client-supplied recipient id -- the one thing the audience
# rules exist to prevent (Global Constraint 3).
AnnouncementAudience = Literal["workspace", "global"]


class AnnouncementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audience: AnnouncementAudience
    # ``notify()`` enforces the same agreement against the CHECK constraints,
    # but it raises a bare ``ValueError`` -- an operator mistake has to be a 422
    # at the boundary, not the worker's generic 500.
    workspace_id: int | None = None
    locales: dict[str, Any]
    default_locale: str
    href: str | None = None
    # Both optional: an announcement published now and never expiring is the
    # common case, and the columns' own defaults express it.
    published_at: datetime | None = None
    expires_at: datetime | None = None

    def payload(self) -> dict[str, Any]:
        return {"locales": self.locales, "default_locale": self.default_locale, "href": self.href}

    @model_validator(mode="after")
    def _workspace_matches_the_audience(self) -> AnnouncementCreate:
        if (self.audience == "workspace") != (self.workspace_id is not None):
            raise ValueError("workspace_id is required for a workspace announcement, and only for one")
        return self


class AnnouncementUpdate(BaseModel):
    """A partial edit. ``locales`` replaces the whole map when present.

    Neither ``audience`` nor ``workspace_id`` is editable: moving a published
    row between audiences would change who may read it *after* people have
    already read it, and the read marks carry no audience of their own to
    re-check. Retire it and publish a new one.
    """

    model_config = ConfigDict(extra="forbid")

    locales: dict[str, Any] | None = None
    default_locale: str | None = None
    href: str | None = None
    expires_at: datetime | None = None

    def changes(self) -> dict[str, Any]:
        """Only the fields the operator actually sent -- an absent ``href`` must
        keep the stored one, while an explicit ``null`` clears it."""
        return self.model_dump(include=self.model_fields_set - {"expires_at"})
