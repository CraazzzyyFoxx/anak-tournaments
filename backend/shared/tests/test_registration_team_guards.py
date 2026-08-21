"""The roster-shape lock for registered teams.

Mirrors ``draft_guards``: a team still holding roster slots must block a shape
change, because its members carry a ``team_slot_code`` assigned from the shape in
force when they accepted. Which states *release* the slots is the whole content of
this guard, so the predicate is asserted by compiling the emitted SQL rather than
by trusting the constants.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from shared.core.errors import BaseAPIException  # noqa: E402
from shared.services.registration_team_guards import (  # noqa: E402
    assert_no_registered_teams,
    has_registered_teams,
    registered_team_status,
)


class _ProbeSession:
    """Records the statement and returns a canned status."""

    def __init__(self, status: str | None) -> None:
        self._status = status
        self.statements: list[object] = []

    async def scalar(self, statement: object) -> str | None:
        self.statements.append(statement)
        return self._status

    def compiled(self) -> str:
        return str(self.statements[0].compile(compile_kwargs={"literal_binds": True}))  # type: ignore[attr-defined]


class RegisteredTeamGuardTests(IsolatedAsyncioTestCase):
    async def test_a_forming_team_locks_the_shape(self) -> None:
        session = _ProbeSession("forming")
        self.assertTrue(await has_registered_teams(session, 7))  # type: ignore[arg-type]

    async def test_no_team_leaves_the_shape_editable(self) -> None:
        session = _ProbeSession(None)
        self.assertFalse(await has_registered_teams(session, 7))  # type: ignore[arg-type]

    async def test_released_and_exported_teams_are_excluded_by_the_query(self) -> None:
        """A disbanded/rejected team holds nothing, and an exported one already
        froze its shape into ``tournament.player`` rows — so neither may block."""
        session = _ProbeSession(None)
        await registered_team_status(session, 7)  # type: ignore[arg-type]
        sql = session.compiled()
        self.assertIn("disbanded", sql)
        self.assertIn("rejected", sql)
        self.assertIn("exported_team_id IS NULL", sql)
        # Soft-deleted teams are gone too.
        self.assertIn("deleted_at IS NULL", sql)
        self.assertIn("tournament_id = 7", sql)

    async def test_the_error_names_the_blocking_status_and_the_change(self) -> None:
        session = _ProbeSession("complete")
        with self.assertRaises(BaseAPIException) as caught:
            await assert_no_registered_teams(session, 7, change="the roster shape")  # type: ignore[arg-type]
        message = str(caught.exception.detail)
        self.assertIn("complete", message)
        self.assertIn("roster shape", message)

    async def test_no_error_when_nothing_is_registered(self) -> None:
        session = _ProbeSession(None)
        await assert_no_registered_teams(session, 7)  # type: ignore[arg-type]
