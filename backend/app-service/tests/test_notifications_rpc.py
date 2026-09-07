"""Behavioural pins for the inbox RPC surface (``rpc.app.notifications_*``).

The three handlers are thin, but the two things they own are exactly the two
things a mock cannot falsify: *which rows an identity is allowed to see* and
*what one round trip carries*. So the handlers run against a real SQL engine
(in-memory SQLite behind the sync-``Session`` shim ``shared/tests/
test_notification_repository.py`` established) with the real repository and the
real audience predicate underneath -- only ``db.async_session_maker`` is
swapped, because no async SQLite driver is installed.

``configure_test_cache()`` in ``conftest.py`` already routes the ``backend:``
prefix the workspace-set cache uses to an in-memory cashews backend, so the
60 s cache is exercised here rather than stubbed out.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import MagicMock, patch

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.models.identity.rbac import Role, user_roles  # noqa: E402
from shared.models.identity.user import User  # noqa: E402
from shared.models.platform.notification import Notification, NotificationRead  # noqa: E402
from shared.models.tenancy.workspace import WorkspaceMember  # noqa: E402
from shared.testing import install_postgres_type_shims  # noqa: E402
from src.rpc import notifications as notifications_rpc  # noqa: E402
from src.services import notifications as notification_service  # noqa: E402

install_postgres_type_shims()

TABLES = (
    Notification.__table__,
    NotificationRead.__table__,
    WorkspaceMember.__table__,
    User.__table__,
    Role.__table__,
    user_roles,
)

ALICE = 100
BOB = 200
ROSTER_WORKSPACE = 7
RBAC_WORKSPACE = 9
OTHER_WORKSPACE = 11

# Far enough back that SQLite's second-resolution ``CURRENT_TIMESTAMP`` is
# unambiguously later, so "already published" never flickers on a fast run.
PAST = datetime.now(UTC) - timedelta(hours=1)

_IDENTITY = {"user_id": ALICE, "username": "alice", "is_active": True, "is_superuser": False}


class _AsyncSessionShim:
    """Async facade over a synchronous ``Session`` -- see module docstring."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement: Any) -> Any:
        return self._session.execute(statement)

    async def flush(self) -> None:
        self._session.flush()

    async def commit(self) -> None:
        self._session.commit()


class _SessionMaker:
    """Stands in for ``db.async_session_maker`` (one shared shim per test)."""

    def __init__(self, shim: _AsyncSessionShim) -> None:
        self._shim = shim

    def __call__(self) -> "_SessionMaker":
        return self

    async def __aenter__(self) -> _AsyncSessionShim:
        return self._shim

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _DeadCache:
    """Stands in for ``cashews.cache`` while Redis is unreachable: every
    operation raises, which is what the client does on a connection error."""

    async def get(self, key: str) -> Any:
        raise ConnectionError("redis is down")

    async def set(self, key: str, value: Any, *, expire: int | None = None) -> None:
        raise ConnectionError("redis is down")


class NotificationsRpcTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = sa.create_engine(
            "sqlite://",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        with self.engine.begin() as conn:
            for schema in sorted({table.schema for table in TABLES if table.schema}):
                conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
            for table in TABLES:
                table.create(conn)
        self.session = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

        maker = _SessionMaker(_AsyncSessionShim(self.session))
        self.handlers: dict[str, Any] = {}
        broker = MagicMock()
        broker.subscriber = self._capture
        notifications_rpc.register(broker, MagicMock())
        self._original_sf = notifications_rpc._SF
        notifications_rpc._SF = maker
        self.addCleanup(setattr, notifications_rpc, "_SF", self._original_sf)

    def _capture(self, subject: str, *args: Any, **kwargs: Any):
        def decorator(fn):
            self.handlers[subject] = fn
            return fn

        return decorator

    async def asyncSetUp(self) -> None:
        # The workspace set is cached per auth_user_id for 60 s in a
        # process-global cashews backend that outlives one test's database.
        for auth_user_id in (ALICE, BOB):
            await cache.delete(
                notification_service.WORKSPACE_IDS_CACHE_KEY.format(auth_user_id=auth_user_id)
            )

    # -- builders ---------------------------------------------------------

    def add(self, **values: Any) -> int:
        values.setdefault("kind", "announcement.published")
        values.setdefault("published_at", PAST)
        row = Notification(**values)
        self.session.add(row)
        self.session.flush()
        return row.id

    def personal(self, recipient: int, **values: Any) -> int:
        return self.add(audience="user", recipient_auth_user_id=recipient, **values)

    def roster_membership(self, auth_user_id: int, workspace_id: int) -> None:
        player = User(name=f"player-{auth_user_id}-{workspace_id}", auth_user_id=auth_user_id)
        self.session.add(player)
        self.session.flush()
        self.session.add(WorkspaceMember(workspace_id=workspace_id, player_id=player.id))
        self.session.flush()

    def rbac_membership(self, auth_user_id: int, workspace_id: int) -> None:
        role = Role(name=f"host-{workspace_id}", workspace_id=workspace_id)
        self.session.add(role)
        self.session.flush()
        # ``created_at`` carries a ``now()`` server default, which SQLite has no
        # function for -- supply it rather than teach the engine a shim.
        self.session.execute(
            sa.insert(user_roles).values(user_id=auth_user_id, role_id=role.id, created_at=PAST)
        )
        self.session.flush()

    def read_marks(self, auth_user_id: int) -> list[int]:
        return sorted(
            self.session.scalars(
                sa.select(NotificationRead.notification_id).where(NotificationRead.auth_user_id == auth_user_id)
            ).all()
        )

    async def call(self, subject: str, data: dict[str, Any]) -> dict[str, Any]:
        return await self.handlers[subject](data, MagicMock())

    # -- the inbox read ---------------------------------------------------

    async def test_list_returns_items_unread_count_and_cursor(self) -> None:
        """One round trip carries the list, the badge count and the next page.

        The bell needs both the rows and the unread count on every open; two
        endpoints would double the request count for a header component that
        renders on every page.
        """
        newest = self.personal(ALICE, kind="team_invite.received", published_at=PAST + timedelta(minutes=2))
        middle = self.personal(ALICE, kind="registration.approved", published_at=PAST + timedelta(minutes=1))
        oldest = self.personal(ALICE, kind="registration.rejected", published_at=PAST)
        self.personal(BOB)

        first = await self.call(
            "rpc.app.notifications_list",
            {"identity": _IDENTITY, "query": {"limit": ["2"]}},
        )

        self.assertTrue(first["ok"], first)
        page = first["data"]
        self.assertEqual([item["id"] for item in page["items"]], [newest, middle])
        self.assertEqual(page["unread_count"], 3)
        self.assertIsNotNone(page["next_cursor"])
        self.assertEqual(page["items"][0]["kind"], "team_invite.received")

        second = await self.call(
            "rpc.app.notifications_list",
            {"identity": _IDENTITY, "query": {"limit": ["2"], "cursor": [page["next_cursor"]]}},
        )

        self.assertTrue(second["ok"], second)
        self.assertEqual([item["id"] for item in second["data"]["items"]], [oldest])
        self.assertIsNone(second["data"]["next_cursor"])
        self.assertEqual(second["data"]["unread_count"], 3)

    async def test_list_reports_which_rows_the_caller_already_read(self) -> None:
        """``is_read`` has to reach the wire, not just the repository.

        The bell distinguishes new from already-seen per row; the badge count
        alone cannot say *which* rows it counts. The field has a default on the
        schema (the announcement banner never serves a read row), so a broken
        hand-off would quietly report everything unread instead of failing.
        """
        seen = self.personal(ALICE, published_at=PAST)
        fresh = self.personal(ALICE, published_at=PAST + timedelta(minutes=1))

        marked = await self.call(
            "rpc.app.notifications_mark_read",
            {"identity": _IDENTITY, "payload": {"ids": [seen]}},
        )
        self.assertTrue(marked["ok"], marked)

        result = await self.call("rpc.app.notifications_list", {"identity": _IDENTITY, "query": {}})

        self.assertTrue(result["ok"], result)
        self.assertEqual(
            {item["id"]: item["is_read"] for item in result["data"]["items"]},
            {fresh: False, seen: True},
        )

    async def test_list_requires_identity(self) -> None:
        """No gateway identity is an ``unauthorized`` envelope, never a 500."""
        self.personal(ALICE)

        result = await self.call("rpc.app.notifications_list", {"query": {}})

        self.assertFalse(result["ok"], result)
        self.assertEqual(result["error"]["code"], "unauthorized")

    async def test_list_rejects_a_malformed_cursor(self) -> None:
        """A mangled cursor is a 422, not a silent reset to page one.

        Resetting would loop a caller that keeps following the cursor it is
        handed; a 500 would page an operator for a client-side defect.
        """
        self.personal(ALICE)

        result = await self.call(
            "rpc.app.notifications_list",
            {"identity": _IDENTITY, "query": {"cursor": ["not-a-cursor!!"]}},
        )

        self.assertFalse(result["ok"], result)
        self.assertEqual(result["error"]["code"], "unprocessable")

    async def test_list_includes_rows_for_roster_and_rbac_workspaces(self) -> None:
        """``:workspaces`` is the union of the roster and the RBAC role holders.

        Either half alone is wrong in a user-visible way: a player with no role
        would miss their workspace's announcements, and an admin who never
        played would miss the ones they are responsible for.
        """
        roster_row = self.add(audience="workspace", workspace_id=ROSTER_WORKSPACE)
        rbac_row = self.add(audience="workspace", workspace_id=RBAC_WORKSPACE)
        self.add(audience="workspace", workspace_id=OTHER_WORKSPACE)
        self.roster_membership(ALICE, ROSTER_WORKSPACE)
        self.rbac_membership(ALICE, RBAC_WORKSPACE)

        result = await self.call("rpc.app.notifications_list", {"identity": _IDENTITY, "query": {}})

        self.assertTrue(result["ok"], result)
        self.assertEqual(
            sorted(item["id"] for item in result["data"]["items"]),
            sorted([roster_row, rbac_row]),
        )

    async def test_workspace_rows_still_arrive_when_the_cache_is_down(self) -> None:
        """A Redis outage costs two queries, never a workspace.

        The membership set is cached, and the failure mode of a cache that
        cannot answer is an *empty* set -- which is not "a bit stale", it is
        every workspace announcement silently gone for everybody. Asserted on
        the inbox payload, not on the cache calls: the point is what the client
        receives while Redis is unreachable.
        """
        roster_row = self.add(audience="workspace", workspace_id=ROSTER_WORKSPACE)
        rbac_row = self.add(audience="workspace", workspace_id=RBAC_WORKSPACE)
        self.add(audience="workspace", workspace_id=OTHER_WORKSPACE)
        self.roster_membership(ALICE, ROSTER_WORKSPACE)
        self.rbac_membership(ALICE, RBAC_WORKSPACE)

        with patch.object(notification_service, "cache", _DeadCache()):
            workspace_ids = await notification_service.workspace_ids_for(
                _AsyncSessionShim(self.session), auth_user_id=ALICE
            )
            result = await self.call("rpc.app.notifications_list", {"identity": _IDENTITY, "query": {}})

        self.assertTrue(result["ok"], result)
        self.assertEqual(
            sorted(item["id"] for item in result["data"]["items"]),
            sorted([roster_row, rbac_row]),
            "workspace announcements vanished while Redis was down",
        )
        self.assertEqual((ROSTER_WORKSPACE, RBAC_WORKSPACE), workspace_ids)

    # -- the announcement banner ------------------------------------------

    async def test_active_announcements_anonymous_returns_only_global(self) -> None:
        """An anonymous banner read may never carry a scoped row.

        The gateway caches this response for everyone, so a single personal or
        workspace row leaking into it is served to every visitor.
        """
        announcement = self.add(audience="global")
        self.add(audience="workspace", workspace_id=ROSTER_WORKSPACE)
        self.personal(ALICE)
        self.roster_membership(ALICE, ROSTER_WORKSPACE)

        result = await self.call("rpc.app.active_announcements", {})

        self.assertTrue(result["ok"], result)
        self.assertEqual([item["id"] for item in result["data"]], [announcement])
        self.assertEqual({item["audience"] for item in result["data"]}, {"global"})

    # -- mark read ---------------------------------------------------------

    async def test_mark_read_with_foreign_id_is_a_no_op(self) -> None:
        """Somebody else's id must not be distinguishable from a nonexistent one.

        Ids are sequential and there are no foreign keys, so any error that
        singles out "this one exists but is not yours" turns ``notification_read``
        into an existence oracle for other people's inboxes.
        """
        bobs_row = self.personal(BOB)

        result = await self.call(
            "rpc.app.notifications_mark_read",
            {"identity": _IDENTITY, "payload": {"ids": [bobs_row]}},
        )

        self.assertTrue(result["ok"], result)
        self.assertEqual(self.read_marks(ALICE), [])
        self.assertEqual(self.read_marks(BOB), [])

        # Control: the same call shape does write for an id Alice may see, so
        # the assertion above is not green because the handler is inert.
        mine = self.personal(ALICE)
        ok = await self.call(
            "rpc.app.notifications_mark_read",
            {"identity": _IDENTITY, "payload": {"ids": [mine, bobs_row]}},
        )
        self.assertTrue(ok["ok"], ok)
        self.assertEqual(self.read_marks(ALICE), [mine])
        self.assertEqual(ok["data"]["unread_count"], 0)
