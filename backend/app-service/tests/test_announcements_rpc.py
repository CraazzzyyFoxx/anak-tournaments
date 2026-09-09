"""Behavioural pins for the announcement CRUD (``rpc.app.announcement_*``).

Three things can only be got wrong once here, and each of them is visible to
somebody who never asked for it:

* the authorization split -- a workspace owner may publish inside their own
  workspace and nowhere else, while the banner every visitor of the platform
  sees is superuser-only;
* the locale rule -- a platform-wide announcement half the users cannot read is
  worse than no announcement, so the shared validator's 422 has to survive the
  trip through the RPC boundary rather than being re-implemented (or skipped)
  here;
* the read marks -- fixing a typo must not un-dismiss the banner for everyone
  who already dismissed it, and retiring an announcement must not orphan the
  marks that record who saw it.

The database is SQLite with the Postgres type shims and the session is a sync
``Session`` behind an async facade: the assertions are about rows, and a real
engine is what makes "the read mark is still there" mean anything.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import MagicMock

import sqlalchemy as sa
from cashews import cache
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.models.platform.audit import AuditLog  # noqa: E402
from shared.models.platform.notification import Notification, NotificationRead  # noqa: E402
from shared.testing import install_postgres_type_shims  # noqa: E402
from src.rpc import announcements as announcements_rpc  # noqa: E402
from src.rpc import notifications as notifications_rpc  # noqa: E402
from src.services import notifications as notification_service  # noqa: E402

install_postgres_type_shims()

TABLES = (Notification.__table__, NotificationRead.__table__, AuditLog.__table__)

WORKSPACE = 7
READER = 500

# Far enough back that SQLite's second-resolution ``CURRENT_TIMESTAMP`` is
# unambiguously later, so "already published" never flickers on a fast run.
PAST = datetime.now(UTC) - timedelta(hours=1)

SUPERUSER = {"user_id": 1, "username": "root", "is_active": True, "is_superuser": True}

# Owner of workspace 7 and nothing else. The owner role grants every
# non-governance action inside that workspace, `announcement.create` included --
# which is exactly what makes the global-audience 403 below meaningful.
OWNER = {
    "user_id": 2,
    "username": "owner",
    "is_active": True,
    "is_superuser": False,
    "workspaces": [{"workspace_id": WORKSPACE, "rbac_roles": ["owner"], "rbac_permissions": []}],
}

OUTSIDER = {"user_id": 3, "username": "outsider", "is_active": True, "is_superuser": False, "workspaces": []}

RU_EN = {"ru": {"title": "Обновление"}, "en": {"title": "Update"}}


class _AsyncSessionShim:
    """Async facade over a synchronous ``Session``."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement: Any) -> Any:
        return self._session.execute(statement)

    async def get(self, entity: Any, ident: Any) -> Any:
        return self._session.get(entity, ident)

    def add(self, instance: Any) -> None:
        self._session.add(instance)

    async def flush(self) -> None:
        self._session.flush()

    async def refresh(self, instance: Any, attribute_names: Any = None) -> None:
        self._session.refresh(instance, attribute_names)

    async def commit(self) -> None:
        self._session.commit()


class _SessionMaker:
    """Stands in for ``db.async_session_maker`` (one shared shim per test)."""

    def __init__(self, shim: _AsyncSessionShim) -> None:
        self._shim = shim

    def __call__(self) -> _SessionMaker:
        return self

    async def __aenter__(self) -> _AsyncSessionShim:
        return self._shim

    async def __aexit__(self, *exc: object) -> bool:
        return False


class AnnouncementRpcTests(IsolatedAsyncioTestCase):
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
        # ``expire_on_commit=False`` mirrors the production session maker: the
        # handlers build their response before the commit, and an expiring
        # session would turn that into a lazy reload the async facade cannot do.
        self.session = Session(self.engine, expire_on_commit=False)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.session.close)

        maker = _SessionMaker(_AsyncSessionShim(self.session))
        self.handlers: dict[str, Any] = {}
        broker = MagicMock()
        broker.subscriber = self._capture
        announcements_rpc.register(broker, MagicMock())
        notifications_rpc.register(broker, MagicMock())
        for module in (announcements_rpc, notifications_rpc):
            original = module._SF
            module._SF = maker
            self.addCleanup(setattr, module, "_SF", original)

    def _capture(self, subject: str, *args: Any, **kwargs: Any):
        def decorator(fn):
            self.handlers[subject] = fn
            return fn

        return decorator

    async def asyncSetUp(self) -> None:
        await cache.delete(notification_service.WORKSPACE_IDS_CACHE_KEY.format(auth_user_id=READER))

    # -- helpers -----------------------------------------------------------

    async def call(self, subject: str, data: dict[str, Any]) -> dict[str, Any]:
        return await self.handlers[subject](data, MagicMock())

    async def create(self, identity: dict, **body: Any) -> dict[str, Any]:
        body.setdefault("audience", "global")
        body.setdefault("locales", RU_EN)
        body.setdefault("default_locale", "ru")
        return await self.call("rpc.app.announcement_create", {"identity": identity, "payload": body})

    def row(self, announcement_id: int) -> Notification:
        return self.session.get(Notification, announcement_id)

    def audit_rows(self) -> list[AuditLog]:
        return list(self.session.scalars(sa.select(AuditLog).order_by(AuditLog.id)).all())

    def read_marks(self) -> list[tuple[int, int]]:
        return sorted(
            (mark.auth_user_id, mark.notification_id)
            for mark in self.session.scalars(sa.select(NotificationRead)).all()
        )

    # -- authorization -----------------------------------------------------

    async def test_global_announcement_requires_superuser(self) -> None:
        """A workspace grant must not reach the platform-wide banner.

        ``announcement.create`` inside a workspace is a tenant-scoped power; the
        global audience is rendered to every visitor of the site, anonymous ones
        included, so it is gated on the platform principal instead.
        """
        denied = await self.create(OWNER, audience="global")

        self.assertFalse(denied["ok"], denied)
        self.assertEqual(denied["error"]["code"], "forbidden")
        self.assertEqual(self.session.scalars(sa.select(Notification)).all(), [])

        allowed = await self.create(SUPERUSER, audience="global")

        self.assertTrue(allowed["ok"], allowed)
        self.assertEqual(allowed["data"]["audience"], "global")

    async def test_workspace_announcement_requires_workspace_permission(self) -> None:
        """The workspace id in the body is authorized, never trusted."""
        denied = await self.create(
            OUTSIDER,
            audience="workspace",
            workspace_id=WORKSPACE,
            locales={"ru": {"title": "Сбор"}},
        )

        self.assertFalse(denied["ok"], denied)
        self.assertEqual(denied["error"]["code"], "forbidden")

        allowed = await self.create(
            OWNER,
            audience="workspace",
            workspace_id=WORKSPACE,
            locales={"ru": {"title": "Сбор"}},
        )

        self.assertTrue(allowed["ok"], allowed)
        self.assertEqual(allowed["data"]["workspace_id"], WORKSPACE)

    async def test_a_workspace_announcement_without_a_workspace_is_a_422(self) -> None:
        """An operator mistake reports as one, instead of paging somebody.

        The database says the same thing through a CHECK constraint, but that
        surfaces as a bare ``ValueError`` inside the worker, which the envelope
        can only report as an internal error.
        """
        result = await self.create(SUPERUSER, audience="workspace", locales={"ru": {"title": "Сбор"}})

        self.assertFalse(result["ok"], result)
        self.assertEqual(result["error"]["code"], "unprocessable")

    async def test_a_personal_audience_is_not_reachable_through_this_crud(self) -> None:
        """Personal notifications are written by domain producers only.

        Accepting ``audience='user'`` here would hand an operator a way to put
        arbitrary text into one named person's inbox, and the recipient id would
        be client-supplied -- the one thing the whole feature refuses to do.
        """
        result = await self.create(SUPERUSER, audience="user", recipient_auth_user_id=READER)

        self.assertFalse(result["ok"], result)
        self.assertEqual(result["error"]["code"], "unprocessable")

    # -- the locale rule ---------------------------------------------------

    async def test_global_announcement_without_english_is_rejected(self) -> None:
        """422 at the RPC boundary, from the one validator that owns the rule."""
        rejected = await self.create(SUPERUSER, locales={"ru": {"title": "Обновление"}})

        self.assertFalse(rejected["ok"], rejected)
        self.assertEqual(rejected["error"]["code"], "unprocessable")
        self.assertIn("en", rejected["error"]["message"] + str(rejected["error"].get("details")))
        self.assertEqual(self.session.scalars(sa.select(Notification)).all(), [])

    # -- the audit trail ---------------------------------------------------

    async def test_create_writes_audit_row(self) -> None:
        """The announcement and its journal entry land in one transaction."""
        created = await self.create(SUPERUSER)
        self.assertTrue(created["ok"], created)

        rows = self.audit_rows()

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].action, "announcement.create")
        self.assertEqual(rows[0].entity_type, "announcement")
        self.assertEqual(rows[0].entity_id, created["data"]["id"])
        self.assertEqual(rows[0].actor_auth_user_id, SUPERUSER["user_id"])

    # -- editing -----------------------------------------------------------

    async def test_update_does_not_clear_read_marks(self) -> None:
        """Fixing a typo must not bring the banner back for everyone.

        The read mark is the dismissal, so any "the text changed, mark it unread
        again" behaviour re-shows a platform-wide banner to every user who
        already closed it -- for a corrected comma.
        """
        created = await self.create(SUPERUSER)
        announcement_id = created["data"]["id"]
        self.session.add(NotificationRead(auth_user_id=READER, notification_id=announcement_id))
        self.session.commit()

        updated = await self.call(
            "rpc.app.announcement_update",
            {
                "identity": SUPERUSER,
                "id": announcement_id,
                "payload": {"locales": {"ru": {"title": "Обновление 2"}, "en": {"title": "Update 2"}}},
            },
        )

        self.assertTrue(updated["ok"], updated)
        self.assertEqual(updated["data"]["payload"]["locales"]["ru"]["title"], "Обновление 2")
        self.assertEqual(self.read_marks(), [(READER, announcement_id)])
        self.assertEqual(self.row(announcement_id).payload_json["locales"]["en"]["title"], "Update 2")

    # -- retiring ----------------------------------------------------------

    async def test_delete_retires_the_announcement_and_keeps_its_read_marks(self) -> None:
        """Delete expires the row instead of dropping it.

        ``notification_read`` references the id with no foreign key, so a hard
        delete leaves marks nothing will ever clean up, and the audit entry
        would point at a row that no longer exists. Expiring hides it from every
        read through the one clause that already filters the time window.
        """
        created = await self.create(SUPERUSER, published_at=PAST.isoformat())
        announcement_id = created["data"]["id"]
        self.session.add(NotificationRead(auth_user_id=READER, notification_id=announcement_id))
        self.session.commit()

        visible = await self.call("rpc.app.active_announcements", {})
        self.assertEqual([item["id"] for item in visible["data"]], [announcement_id])

        deleted = await self.call("rpc.app.announcement_delete", {"identity": SUPERUSER, "id": announcement_id})

        self.assertTrue(deleted["ok"], deleted)
        banner = await self.call("rpc.app.active_announcements", {})
        self.assertEqual(banner["data"], [])
        self.assertIsNotNone(self.row(announcement_id))
        self.assertEqual(self.read_marks(), [(READER, announcement_id)])
        self.assertEqual([row.action for row in self.audit_rows()][-1], "announcement.delete")

    # -- the operator list -------------------------------------------------

    async def test_list_shows_the_workspace_its_own_announcements_only(self) -> None:
        """The operator list is scoped the same way the writes are.

        Without the scope an owner of one workspace would read the drafts, the
        schedule and the retired announcements of every other tenant.
        """
        mine = await self.create(OWNER, audience="workspace", workspace_id=WORKSPACE, locales={"ru": {"title": "Сбор"}})
        await self.create(SUPERUSER, audience="workspace", workspace_id=99, locales={"ru": {"title": "Чужое"}})
        await self.create(SUPERUSER, audience="global")

        listed = await self.call(
            "rpc.app.announcement_list", {"identity": OWNER, "query": {"workspace_id": [str(WORKSPACE)]}}
        )

        self.assertTrue(listed["ok"], listed)
        self.assertEqual([item["id"] for item in listed["data"]], [mine["data"]["id"]])
