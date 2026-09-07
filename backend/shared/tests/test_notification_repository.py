"""Behavioural pins for the notification audience predicate and its reads.

``NotificationRepository.audience_clause`` is the only cross-tenant boundary in
the notifications feature: every read and the mark-read write funnel through it,
and a single reversed comparison there leaks another user's inbox (ids are
sequential, so "which ids exist" is a probe away). So the tests below run the
*real* statements against a real SQL engine rather than asserting on mocks --
the claims under test are properties of the emitted SQL (which rows come back,
which read marks land), and a mocked session cannot falsify any of them.

The engine is in-memory SQLite, the fixture shape ``test_newcomer_status.py``
and ``test_notification_model.py`` already use: ``jsonb`` degrades through the
shared ``install_postgres_type_shims`` shim, and no async SQLite driver is
installed, so a synchronous ``Session`` behind ``_AsyncSessionShim`` runs the
genuine statements without pulling in aiosqlite.

Two brief tests are reformulated. "Workspace notification needs membership"
was written as "absent for a non-member, present for a roster member, present
for an RBAC role holder"; the repository does not compute the membership set --
it takes ``workspace_ids`` as a parameter (the service layer of Task 4 unions
roster and RBAC and caches it in Redis). Both halves of that union therefore
reach this layer identically, as a workspace id that either is or is not in the
sequence, which is what the test asserts.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))

from shared.models.platform.notification import Notification, NotificationRead  # noqa: E402
from shared.repository.notification import InvalidCursorError, NotificationRepository  # noqa: E402
from shared.testing import install_postgres_type_shims  # noqa: E402

install_postgres_type_shims()

TABLES = (Notification.__table__, NotificationRead.__table__)

ALICE = 100
BOB = 200
# A workspace id that only ever reaches the repository through the
# ``workspace_ids`` parameter -- see the module docstring.
WORKSPACE = 7

# Far enough in the past that SQLite's second-resolution ``CURRENT_TIMESTAMP``
# is unambiguously later, so "already published" never flickers on a fast run.
PAST = datetime.now(UTC) - timedelta(hours=1)


class _AsyncSessionShim:
    """Async facade over a synchronous ``Session`` -- see module docstring."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement):  # noqa: ANN001, ANN202
        return self._session.execute(statement)

    async def flush(self) -> None:
        self._session.flush()


class NotificationRepositoryTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = sa.create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        with self.engine.begin() as conn:
            for table in TABLES:
                table.create(conn)
        self.session = Session(self.engine)
        self.shim = _AsyncSessionShim(self.session)
        self.repo = NotificationRepository()
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

    # -- builders ---------------------------------------------------------

    def add(self, **values) -> int:  # noqa: ANN003
        values.setdefault("kind", "announcement.published")
        values.setdefault("published_at", PAST)
        row = Notification(**values)
        self.session.add(row)
        self.session.flush()
        return row.id

    def personal(self, recipient: int, **values) -> int:  # noqa: ANN003
        return self.add(audience="user", recipient_auth_user_id=recipient, **values)

    def read_marks(self, auth_user_id: int) -> list[int]:
        return sorted(
            self.session.scalars(
                sa.select(NotificationRead.notification_id).where(NotificationRead.auth_user_id == auth_user_id)
            ).all()
        )

    async def page_ids(self, auth_user_id: int | None, *, workspace_ids: tuple[int, ...] = ()) -> list[int]:
        page = await self.repo.page(self.shim, auth_user_id=auth_user_id, workspace_ids=workspace_ids)
        return [row.id for row in page.items]

    # -- audience ---------------------------------------------------------

    async def test_other_users_personal_notification_is_invisible(self) -> None:
        alice_row = self.personal(ALICE, kind="team_invite.received")
        bob_row = self.personal(BOB, kind="team_invite.received")

        self.assertEqual(await self.page_ids(ALICE), [alice_row])
        self.assertEqual(await self.page_ids(BOB), [bob_row])

    async def test_workspace_notification_needs_membership(self) -> None:
        row = self.add(audience="workspace", workspace_id=WORKSPACE)

        self.assertEqual(await self.page_ids(ALICE), [])
        self.assertEqual(await self.page_ids(ALICE, workspace_ids=(WORKSPACE,)), [row])
        # A membership in some *other* workspace must not widen the predicate.
        self.assertEqual(await self.page_ids(ALICE, workspace_ids=(WORKSPACE + 1,)), [])
        self.assertEqual(await self.page_ids(BOB, workspace_ids=(WORKSPACE + 1, WORKSPACE)), [row])

    async def test_global_notification_is_visible_to_everyone(self) -> None:
        row = self.add(audience="global")

        self.assertEqual(await self.page_ids(ALICE), [row])
        self.assertEqual(await self.page_ids(BOB, workspace_ids=()), [row])
        # Anonymous banner read: no identity at all.
        self.assertEqual([r.id for r in await self.repo.active_global(self.shim)], [row])

    async def test_unpublished_and_expired_rows_are_hidden(self) -> None:
        now = datetime.now(UTC)
        future = self.personal(ALICE, published_at=now + timedelta(hours=1))
        expired = self.personal(ALICE, published_at=PAST, expires_at=now - timedelta(minutes=1))
        live = self.personal(ALICE, published_at=PAST, expires_at=now + timedelta(hours=1))
        never_expires = self.personal(ALICE, published_at=PAST)

        visible = await self.page_ids(ALICE)
        self.assertEqual(visible, sorted([live, never_expires], reverse=True))
        self.assertNotIn(future, visible)
        self.assertNotIn(expired, visible)
        self.assertEqual(await self.repo.unread_count(self.shim, auth_user_id=ALICE), 2)

    # -- cursor -----------------------------------------------------------

    async def test_cursor_page_is_stable_when_published_at_ties(self) -> None:
        """Five rows, one timestamp: the bug offset pagination has here.

        ``notify()`` writes ``func.now()``, which is the *transaction* clock, so
        a batch fan-out (both captains of a disputed encounter, a workspace
        announcement) genuinely ties. Under ``ORDER BY published_at DESC`` alone
        the tie order is unspecified between statements, and OFFSET paging then
        repeats or skips rows; the ``(published_at, id)`` cursor must not.
        """
        ids = [self.personal(ALICE, published_at=PAST) for _ in range(5)]

        seen: list[int] = []
        cursor: str | None = None
        for _ in range(4):
            page = await self.repo.page(self.shim, auth_user_id=ALICE, cursor=cursor, limit=2)
            seen.extend(row.id for row in page.items)
            cursor = page.next_cursor
            if cursor is None:
                break

        self.assertIsNone(cursor, "pagination did not terminate")
        self.assertEqual(sorted(seen), sorted(ids))
        self.assertEqual(len(seen), len(set(seen)), "a row came back on two pages")
        self.assertEqual(seen, sorted(ids, reverse=True))

    async def test_invalid_cursor_is_rejected(self) -> None:
        """A malformed cursor is a client error, not a silent reset to page 1.

        Silently restarting turns a truncated or mangled cursor into an infinite
        loop for the caller that keeps paging.
        """
        self.personal(ALICE)
        for bad in ("not-base64!!", "", "Zm9vfGJhcg=="):
            with self.subTest(cursor=bad), self.assertRaises(InvalidCursorError):
                await self.repo.page(self.shim, auth_user_id=ALICE, cursor=bad)

    # -- unread count -----------------------------------------------------

    async def test_unread_count_excludes_read_rows(self) -> None:
        first = self.personal(ALICE)
        self.personal(ALICE)
        announcement = self.add(audience="global")
        self.personal(BOB)

        self.assertEqual(await self.repo.unread_count(self.shim, auth_user_id=ALICE), 3)

        await self.repo.mark_read(self.shim, auth_user_id=ALICE, notification_ids=[first, announcement])

        self.assertEqual(await self.repo.unread_count(self.shim, auth_user_id=ALICE), 1)
        # Alice's marks must not silence Bob's own copy of the announcement.
        self.assertEqual(await self.repo.unread_count(self.shim, auth_user_id=BOB), 2)
        self.assertEqual(self.read_marks(ALICE), sorted([first, announcement]))

    # -- mark read --------------------------------------------------------

    async def test_mark_read_ignores_ids_outside_the_audience(self) -> None:
        mine = self.personal(ALICE)
        bobs = self.personal(BOB)
        other_workspace = self.add(audience="workspace", workspace_id=WORKSPACE)

        # No raise, no distinguishable outcome: a read mark must never confirm
        # that some id exists or belongs to somebody.
        marked = await self.repo.mark_read(
            self.shim,
            auth_user_id=ALICE,
            notification_ids=[bobs, other_workspace, 10_000],
        )
        self.assertEqual(marked, 0)
        self.assertEqual(self.read_marks(ALICE), [])

        # Control: the same call shape does insert for an id Alice may see, so
        # the assertion above is not green because mark_read is inert.
        self.assertEqual(await self.repo.mark_read(self.shim, auth_user_id=ALICE, notification_ids=[mine, bobs]), 1)
        self.assertEqual(self.read_marks(ALICE), [mine])

    async def test_mark_read_is_idempotent(self) -> None:
        row = self.personal(ALICE)

        self.assertEqual(await self.repo.mark_read(self.shim, auth_user_id=ALICE, notification_ids=[row]), 1)
        first_read_at = self.session.scalar(
            sa.select(NotificationRead.read_at).where(NotificationRead.notification_id == row)
        )

        self.assertEqual(await self.repo.mark_read(self.shim, auth_user_id=ALICE, notification_ids=[row]), 0)

        self.assertEqual(self.read_marks(ALICE), [row])
        self.assertEqual(
            self.session.scalar(sa.select(NotificationRead.read_at).where(NotificationRead.notification_id == row)),
            first_read_at,
            "a repeat mark must not move read_at",
        )

    async def test_mark_read_without_ids_marks_the_whole_visible_inbox(self) -> None:
        mine = self.personal(ALICE)
        announcement = self.add(audience="global")
        workspace_row = self.add(audience="workspace", workspace_id=WORKSPACE)
        bobs = self.personal(BOB)
        unpublished = self.personal(ALICE, published_at=datetime.now(UTC) + timedelta(hours=1))

        marked = await self.repo.mark_read(self.shim, auth_user_id=ALICE, workspace_ids=(WORKSPACE,))

        self.assertEqual(marked, 3)
        self.assertEqual(self.read_marks(ALICE), sorted([mine, announcement, workspace_row]))
        self.assertNotIn(bobs, self.read_marks(ALICE))
        self.assertNotIn(unpublished, self.read_marks(ALICE))
        self.assertEqual(await self.repo.unread_count(self.shim, auth_user_id=ALICE, workspace_ids=(WORKSPACE,)), 0)

    # -- banner -----------------------------------------------------------

    async def test_active_global_skips_dismissed_and_scoped_rows(self) -> None:
        now = datetime.now(UTC)
        live = self.add(audience="global")
        dismissed = self.add(audience="global")
        self.add(audience="global", expires_at=now - timedelta(minutes=1))
        self.add(audience="workspace", workspace_id=WORKSPACE)
        self.personal(ALICE)

        await self.repo.mark_read(self.shim, auth_user_id=ALICE, notification_ids=[dismissed])

        self.assertEqual([r.id for r in await self.repo.active_global(self.shim, auth_user_id=ALICE)], [live])
        # Anonymous visitors have nowhere to store a dismissal, so they see both.
        self.assertEqual(
            [r.id for r in await self.repo.active_global(self.shim)],
            sorted([live, dismissed], reverse=True),
        )
