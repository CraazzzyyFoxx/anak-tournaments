"""Reads and read-marks for the notification inbox.

Everything in this module hangs off one predicate. :meth:`
NotificationRepository.audience_clause` answers "may this identity see this
row", and it is the *only* place that answers it: the inbox page, the unread
badge, the mark-read write and the announcement banner all compose it rather
than re-stating "and recipient = me". Notification ids are sequential and there
are no foreign keys, so a second, slightly different copy of the predicate is
how another user's inbox leaks -- either directly, or as an existence oracle
through ``notification_read``.

The membership set is *not* computed here. ``workspace_ids`` arrives as a
parameter because it is the union of the workspace roster and the RBAC role
holders, which the service layer resolves once and caches in Redis per user;
a repository that fired those queries itself would run them on every read.
Passing an empty sequence is the honest "this identity is in no workspace",
and ``auth_user_id=None`` is the honest "anonymous", which leaves exactly the
``global`` rows visible -- the banner's read.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Sequence
from datetime import datetime
from typing import NamedTuple

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository

__all__ = (
    "DEFAULT_PAGE_LIMIT",
    "MAX_PAGE_LIMIT",
    "InvalidCursorError",
    "NotificationPage",
    "NotificationRepository",
    "decode_cursor",
    "encode_cursor",
)

DEFAULT_PAGE_LIMIT = 20
MAX_PAGE_LIMIT = 100

_CURSOR_SEPARATOR = "|"


class InvalidCursorError(ValueError):
    """A page cursor that did not come from :func:`encode_cursor`.

    Subclasses ``ValueError`` for the same reason ``RosterShapeError`` does:
    the RPC layer turns it into a 422. Falling back to the first page instead
    would be worse than an error -- a caller that keeps following the cursor it
    is handed would loop over page one forever.
    """


class NotificationPage(NamedTuple):
    items: Sequence[models.Notification]
    next_cursor: str | None


def encode_cursor(row: models.Notification) -> str:
    """Opaque continuation token for the row a page ended on.

    Opaque on purpose: the pair it carries is an ordering detail, and a client
    that parses ``published_at`` out of it starts depending on the sort key.
    """
    raw = f"{row.published_at.isoformat()}{_CURSOR_SEPARATOR}{row.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        published_at, separator, row_id = raw.rpartition(_CURSOR_SEPARATOR)
        if not separator:
            raise ValueError("missing separator")
        return datetime.fromisoformat(published_at), int(row_id)
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise InvalidCursorError("Malformed notification page cursor") from exc


class NotificationRepository(BaseRepository[models.Notification]):
    def __init__(self) -> None:
        super().__init__(models.Notification)

    def audience_clause(
        self,
        *,
        auth_user_id: int | None,
        workspace_ids: Sequence[int] = (),
    ) -> sa.ColumnElement[bool]:
        """WHERE term for "rows this identity is allowed to see, right now".

        Audience and time window are one clause, never two: the plan's SQL
        sketch wrote them as ``... or audience = 'global' and published_at <=
        now() ...``, where SQL precedence binds the window to the ``global``
        branch alone and lets an unpublished personal row through. Both halves
        are conjoined here for every branch.
        """
        model = self.model
        now = sa.func.now()

        visible: list[sa.ColumnElement[bool]] = [model.audience == "global"]
        if auth_user_id is not None:
            visible.append(
                sa.and_(model.audience == "user", model.recipient_auth_user_id == auth_user_id),
            )
        if workspace_ids:
            visible.append(
                sa.and_(model.audience == "workspace", model.workspace_id.in_(tuple(workspace_ids))),
            )

        return sa.and_(
            sa.or_(*visible),
            model.published_at <= now,
            sa.or_(model.expires_at.is_(None), model.expires_at > now),
        )

    def _unread(self, auth_user_id: int) -> sa.ColumnElement[bool]:
        mark = models.NotificationRead
        return ~sa.exists().where(
            mark.auth_user_id == auth_user_id,
            mark.notification_id == self.model.id,
        )

    async def page(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int | None,
        workspace_ids: Sequence[int] = (),
        cursor: str | None = None,
        limit: int = DEFAULT_PAGE_LIMIT,
    ) -> NotificationPage:
        """One page of the inbox, newest first, keyset-paginated.

        The cursor is ``(published_at, id)`` rather than an offset because
        ``published_at`` ties are normal, not exotic: ``notify()`` stamps
        ``func.now()``, the transaction clock, so a fan-out to both captains of
        a disputed encounter writes identical timestamps. Under OFFSET the tie
        order is unspecified between statements and rows repeat or vanish
        between pages -- the same defect ``AuditLogService._order_by``
        documents.
        """
        model = self.model
        limit = max(1, min(int(limit), MAX_PAGE_LIMIT))

        query = self.select().where(
            self.audience_clause(auth_user_id=auth_user_id, workspace_ids=workspace_ids),
        )
        if cursor is not None:
            after_published_at, after_id = decode_cursor(cursor)
            # Typed literals, not bare values: an untyped ``datetime`` bind
            # infers ``TIMESTAMP WITHOUT TIME ZONE`` and asyncpg then refuses
            # the aware value the column round-trips as.
            query = query.where(
                sa.tuple_(model.published_at, model.id)
                < sa.tuple_(
                    sa.literal(after_published_at, model.published_at.type),
                    sa.literal(after_id, model.id.type),
                ),
            )

        # One row past the page: the only way to answer "is there a next page"
        # without a second COUNT over the same predicate.
        result = await session.execute(
            query.order_by(model.published_at.desc(), model.id.desc()).limit(limit + 1),
        )
        rows = list(result.scalars().all())
        if len(rows) > limit:
            return NotificationPage(rows[:limit], encode_cursor(rows[limit - 1]))
        return NotificationPage(rows, None)

    async def unread_count(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int,
        workspace_ids: Sequence[int] = (),
    ) -> int:
        """Badge count: visible rows this user has no read mark for."""
        query = sa.select(sa.func.count(self.model.id)).where(
            self.audience_clause(auth_user_id=auth_user_id, workspace_ids=workspace_ids),
            self._unread(auth_user_id),
        )
        result = await session.execute(query)
        return result.scalar_one()

    async def mark_read(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int,
        workspace_ids: Sequence[int] = (),
        notification_ids: Sequence[int] | None = None,
    ) -> int:
        """Insert read marks for ids this user may see. Returns how many landed.

        ``notification_ids=None`` means "mark the whole visible inbox".

        The ids never reach the INSERT as values: they narrow a SELECT that
        already carries :meth:`audience_clause`, so an id belonging to someone
        else contributes no row instead of being rejected. That is deliberate --
        rejecting it (a 404, a constraint violation, any distinguishable error)
        would answer "does notification 8231 exist and is it someone's" for
        every sequential id a caller cares to try.

        ``ON CONFLICT DO NOTHING`` makes the repeat call a no-op rather than a
        duplicate-key error, and leaves the original ``read_at`` in place: the
        answer to "when did you first see this" must not drift on a refetch.
        """
        selected = sa.select(sa.literal(auth_user_id), self.model.id).where(
            self.audience_clause(auth_user_id=auth_user_id, workspace_ids=workspace_ids),
        )
        if notification_ids is not None:
            ids = {int(value) for value in notification_ids}
            if not ids:
                return 0
            selected = selected.where(self.model.id.in_(ids))

        statement = (
            pg_insert(models.NotificationRead.__table__)
            .from_select(["auth_user_id", "notification_id"], selected)
            .on_conflict_do_nothing()
        )
        result = await session.execute(statement)
        return max(result.rowcount, 0)

    async def active_global(
        self,
        session: AsyncSession,
        *,
        auth_user_id: int | None = None,
    ) -> Sequence[models.Notification]:
        """Platform-wide announcements to render as a banner, newest first.

        ``auth_user_id=None`` is the anonymous read the gateway's public
        response cache covers; with an identity, a read mark means "dismissed"
        and the row stops coming back. Anonymous visitors have nowhere to store
        a dismissal, so the frontend keeps that in local storage.
        """
        query = self.select().where(self.audience_clause(auth_user_id=None, workspace_ids=()))
        if auth_user_id is not None:
            query = query.where(self._unread(auth_user_id))

        result = await session.execute(
            query.order_by(self.model.published_at.desc(), self.model.id.desc()),
        )
        return list(result.scalars().all())
