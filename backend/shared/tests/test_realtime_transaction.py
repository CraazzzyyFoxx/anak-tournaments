"""Unit tests for `register_realtime_update` — the dedupe-then-publish
transactional staging factory (`shared.services.realtime_transaction`).

Exercises the ACTUAL SQLAlchemy `before_flush`/`after_commit`/`after_rollback`
listeners, not the internal pop helpers directly: they're attached to
`sqlalchemy.orm.Session` globally, so a real sync `Session` backed by an
in-memory SQLite database triggers them exactly as production's
`AsyncSession.sync_session` does.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_root))

from shared.models.platform.realtime import WorkspaceEvent  # noqa: E402
from shared.services import realtime_transaction  # noqa: E402
from shared.services.realtime_transaction import register_realtime_update  # noqa: E402
from shared.testing import install_postgres_type_shims


install_postgres_type_shims()


REDIS_URL = "redis://localhost:6379/0"
_MARKER_TOPIC = "__marker__"


def _make_event(topic: str, *, occurred_at: datetime | None = None) -> WorkspaceEvent:
    return WorkspaceEvent(
        topic=topic,
        event_type="test.updated",
        schema_version=1,
        payload={"topic": topic},
        occurred_at=occurred_at or datetime.now(UTC),
    )


class RealtimeTransactionTests(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.begin() as conn:
            conn.exec_driver_sql("ATTACH DATABASE ':memory:' AS realtime")
            WorkspaceEvent.__table__.create(conn)

        self.session = Session(self.engine)
        self.addCleanup(self.session.close)

    def _touch(self) -> None:
        """Add a throwaway ORM-tracked row so `flush()`/`commit()` actually
        dispatch `before_flush` — SQLAlchemy skips that event entirely when
        nothing in the session is new/dirty/deleted, which staging via
        `session.info` alone (what `register_realtime_update` does) never is.
        """
        self.session.add(_make_event(_MARKER_TOPIC))

    def _topics(self) -> list[str]:
        rows = (
            self.session.execute(sa.select(WorkspaceEvent.topic).where(WorkspaceEvent.topic != _MARKER_TOPIC))
            .scalars()
            .all()
        )
        return sorted(rows)

    async def test_dedup_by_key_only_the_last_builder_is_ever_called(self) -> None:
        calls: list[str] = []

        def first() -> WorkspaceEvent:
            calls.append("first")
            return _make_event("first:topic")

        def second() -> WorkspaceEvent:
            calls.append("second")
            return _make_event("second:topic")

        register_realtime_update(self.session, key=(1, "k"), build_event=first, redis_url=REDIS_URL)
        register_realtime_update(self.session, key=(1, "k"), build_event=second, redis_url=REDIS_URL)
        self._touch()

        with patch.object(realtime_transaction, "publish_event_to_redis_url", AsyncMock()):
            self.session.commit()
            await asyncio.sleep(0)

        self.assertEqual(calls, ["second"])
        self.assertEqual(self._topics(), ["second:topic"])

    async def test_distinct_keys_each_persist_their_own_row(self) -> None:
        register_realtime_update(
            self.session, key=(1, "a"), build_event=lambda: _make_event("topic:a"), redis_url=REDIS_URL
        )
        register_realtime_update(
            self.session, key=(2, "b"), build_event=lambda: _make_event("topic:b"), redis_url=REDIS_URL
        )
        self._touch()

        with patch.object(realtime_transaction, "publish_event_to_redis_url", AsyncMock()):
            self.session.commit()
            await asyncio.sleep(0)

        self.assertEqual(self._topics(), ["topic:a", "topic:b"])

    async def test_publish_fires_only_after_commit_never_before(self) -> None:
        register_realtime_update(
            self.session, key=(1, "a"), build_event=lambda: _make_event("topic:a"), redis_url=REDIS_URL
        )
        self._touch()

        with patch.object(realtime_transaction, "publish_event_to_redis_url", AsyncMock()) as publish:
            self.session.flush()
            publish.assert_not_awaited()

            self.session.commit()
            publish.assert_not_awaited()  # scheduled via create_task, not yet run
            await asyncio.sleep(0)
            publish.assert_awaited_once()
            self.assertEqual(publish.await_args.kwargs["topic"], "topic:a")

    async def test_after_rollback_clears_staged_state_without_publishing(self) -> None:
        # `rollback()` is a pass-through with no active transaction (SQLAlchemy
        # only dispatches `after_rollback` when there is one to roll back) — a
        # trivial query is enough to autobegin one, matching a real production
        # session that has already touched the DB before registering an update.
        self.session.execute(sa.text("SELECT 1"))
        register_realtime_update(
            self.session, key=(1, "a"), build_event=lambda: _make_event("topic:a"), redis_url=REDIS_URL
        )

        with patch.object(realtime_transaction, "publish_event_to_redis_url", AsyncMock()) as publish:
            self.session.rollback()
            await asyncio.sleep(0)
            publish.assert_not_awaited()

        self.assertNotIn(realtime_transaction._SESSION_KEY, self.session.info)
        self.assertNotIn(realtime_transaction._SESSION_EVENTS_KEY, self.session.info)
        self.assertEqual(self._topics(), [])

    async def test_a_raising_build_event_propagates_out_of_flush(self) -> None:
        def boom() -> WorkspaceEvent:
            raise RuntimeError("build blew up")

        register_realtime_update(self.session, key=(1, "a"), build_event=boom, redis_url=REDIS_URL)
        self._touch()

        with self.assertRaises(RuntimeError):
            self.session.flush()

    async def test_build_event_returning_none_stages_nothing(self) -> None:
        register_realtime_update(self.session, key=(1, "a"), build_event=lambda: None, redis_url=REDIS_URL)
        self._touch()

        with patch.object(realtime_transaction, "publish_event_to_redis_url", AsyncMock()) as publish:
            self.session.commit()
            await asyncio.sleep(0)
            publish.assert_not_awaited()

        self.assertEqual(self._topics(), [])

    async def test_build_event_returning_a_sequence_persists_every_row_under_one_key(self) -> None:
        register_realtime_update(
            self.session,
            key=(1, "a"),
            build_event=lambda: [_make_event("topic:a1"), _make_event("topic:a2")],
            redis_url=REDIS_URL,
        )
        self._touch()

        with patch.object(realtime_transaction, "publish_event_to_redis_url", AsyncMock()) as publish:
            self.session.commit()
            await asyncio.sleep(0)
            self.assertEqual(publish.await_count, 2)

        self.assertEqual(self._topics(), ["topic:a1", "topic:a2"])
