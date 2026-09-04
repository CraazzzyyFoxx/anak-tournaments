"""The workspace default may not be re-shaped under a draft that inherits it.

The per-tournament write already refuses this (tournament-service admin update:
``assert_no_active_draft_session`` + ``assert_no_registered_teams``). The
workspace default is inherited by every tournament with no ``roster_slots_json``
of its own, so without the same bar an organizer editing it re-shapes a live
draft's roster mid-pick — a 1/2/2 team then accepts a second tank, because the
slot rule is asked about a shape nobody drafted into.
"""

from __future__ import annotations

from typing import Any
from unittest import IsolatedAsyncioTestCase

from shared.core.errors import BaseAPIException
from shared.services.roster_shape_guards import (
    assert_workspace_roster_shape_unlocked,
    workspace_roster_shape_lock,
)


class _FakeResult:
    def __init__(self, row: tuple[Any, ...] | None) -> None:
        self._row = row

    def first(self) -> tuple[Any, ...] | None:
        return self._row


class _FakeSession:
    """Answers the guard's two reads in order and records the emitted SQL."""

    def __init__(self, *rows: tuple[Any, ...] | None) -> None:
        self._rows = list(rows)
        self.sql: list[str] = []

    async def execute(self, statement: Any) -> _FakeResult:
        self.sql.append(str(statement.compile(compile_kwargs={"literal_binds": True})))
        return _FakeResult(self._rows.pop(0) if self._rows else None)


class WorkspaceRosterShapeGuardTests(IsolatedAsyncioTestCase):
    async def test_an_unlocked_workspace_passes_and_costs_two_reads(self) -> None:
        session = _FakeSession(None, None)

        await assert_workspace_roster_shape_unlocked(session, 7)  # type: ignore[arg-type]

        self.assertEqual(2, len(session.sql))

    async def test_a_live_draft_blocks_and_names_the_tournament_and_status(self) -> None:
        session = _FakeSession((42, "live"))

        with self.assertRaises(BaseAPIException) as caught:
            await assert_workspace_roster_shape_unlocked(session, 7)  # type: ignore[arg-type]

        self.assertEqual(400, caught.exception.status_code)
        self.assertIn("42", str(caught.exception.detail))
        self.assertIn("live", str(caught.exception.detail))
        # The team read never runs: the first blocker is enough to refuse.
        self.assertEqual(1, len(session.sql))

    async def test_a_registered_team_blocks_too(self) -> None:
        session = _FakeSession(None, (43, "complete"))

        with self.assertRaises(BaseAPIException) as caught:
            await assert_workspace_roster_shape_unlocked(session, 7)  # type: ignore[arg-type]

        self.assertEqual(400, caught.exception.status_code)
        self.assertIn("43", str(caught.exception.detail))

    async def test_both_reads_only_look_at_tournaments_that_inherit_the_default(self) -> None:
        # A tournament with its own override is unaffected by the default, so it
        # must not block the write — this predicate is the whole scoping.
        session = _FakeSession(None, None)

        await workspace_roster_shape_lock(session, 7)  # type: ignore[arg-type]

        for sql in session.sql:
            self.assertIn("roster_slots_json IS NULL", sql)
            self.assertIn("workspace_id = 7", sql)
        self.assertIn("draft_session.status NOT IN ('cancelled', 'completed')", session.sql[0])
        self.assertIn("registration_team.exported_team_id IS NULL", session.sql[1])
