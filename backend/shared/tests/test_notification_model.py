"""Behavioural pins for the ``notification`` / ``notification_read`` tables.

The four CHECK constraints are the only thing standing between the audience
predicate and rows it cannot answer for -- a ``user`` row with no recipient is
invisible to everybody, a ``workspace`` row carrying a recipient is visible to
one person under a rule written for a whole workspace. Asserting they exist in
the metadata would prove nothing about enforcement, so every case here goes
through a real INSERT.

The engine is in-memory SQLite, the same fixture shape
``test_realtime_transaction.py`` and ``test_encounter_match_delete_cascade.py``
use: SQLite enforces CHECK constraints and composite primary keys, which is
exactly what these tests interrogate. The Postgres-only parts of the DDL are
not: ``jsonb`` degrades to SQLite ``JSON`` through the shared
``install_postgres_type_shims`` shim, and the partial index predicate is a
dialect kwarg that renders on Postgres and is inert here. Those two are pinned
by the migration's rendered SQL, not by this file.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))

from shared.models.platform.notification import Notification, NotificationRead  # noqa: E402
from shared.testing import install_postgres_type_shims  # noqa: E402

install_postgres_type_shims()


class NotificationConstraintTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.begin() as conn:
            Notification.__table__.create(conn)
            NotificationRead.__table__.create(conn)

        self.session = Session(self.engine)
        self.addCleanup(self.session.close)

    def _insert(self, row: object) -> None:
        self.session.add(row)
        self.session.flush()

    def test_user_audience_requires_recipient(self) -> None:
        with self.assertRaises(IntegrityError):
            self._insert(Notification(audience="user", recipient_auth_user_id=None, kind="x"))

    def test_workspace_audience_rejects_recipient(self) -> None:
        with self.assertRaises(IntegrityError):
            self._insert(
                Notification(audience="workspace", workspace_id=1, recipient_auth_user_id=7, kind="x"),
            )

    def test_global_audience_needs_neither(self) -> None:
        self._insert(Notification(audience="global", kind="announcement.published"))

        stored = self.session.execute(sa.select(Notification)).scalar_one()
        self.assertIsNone(stored.recipient_auth_user_id)
        self.assertIsNone(stored.workspace_id)
        self.assertIsNotNone(stored.published_at)

    def test_read_mark_is_unique_per_user(self) -> None:
        self._insert(NotificationRead(auth_user_id=7, notification_id=42))

        with self.assertRaises(IntegrityError):
            self._insert(NotificationRead(auth_user_id=7, notification_id=42))
