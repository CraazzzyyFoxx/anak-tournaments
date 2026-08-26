"""Unit tests for ``shared.services.newcomer_status.load_prior_participation``.

Runs the *real* queries against a real SQL engine (SQLite standing in for
Postgres, no aiosqlite installed -- see ``_AsyncSessionShim``) rather than
asserting on mocks: the claims under test are properties of the emitted SQL
(chronological ordering, the NULL-``start_date`` sentinel, workspace scoping),
which a mocked session cannot falsify.

The "current" tournament passed to ``load_prior_participation`` is a bare
``SimpleNamespace`` (only ``.id``/``.start_date``/``.workspace_id`` are read) --
it never needs to exist as a DB row, since the comparison binds those values as
plain parameters. "Prior" tournaments the function discovers via its join DO
need real rows.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_root))

from shared.core.enums import HeroClass  # noqa: E402
from shared.models.tenancy.workspace import Workspace, WorkspaceMember  # noqa: E402
from shared.models.tournament.team import Player, Team  # noqa: E402
from shared.models.tournament.tournament import Tournament  # noqa: E402
from shared.services.newcomer_status import load_prior_participation  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


TABLES = (
    Workspace.__table__,
    WorkspaceMember.__table__,
    Tournament.__table__,
    Team.__table__,
    Player.__table__,
)


class _AsyncSessionShim:
    """Async facade over a synchronous ``Session`` -- see module docstring."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement):  # noqa: ANN001, ANN202
        return self._session.execute(statement)


class _Fixture:
    """A throwaway in-memory database plus row builders for it."""

    def __init__(self) -> None:
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
        self.shim = _AsyncSessionShim(self.session)
        self._next_id = 1

    def close(self) -> None:
        self.session.close()
        self.engine.dispose()

    def _id(self) -> int:
        value = self._next_id
        self._next_id += 1
        return value

    def insert(self, table, **values) -> None:  # noqa: ANN001, ANN003
        self.session.execute(sa.insert(table).values(**values))

    def workspace(self, workspace_id: int, *, newcomer_scope: str = "global") -> int:
        self.insert(
            Workspace.__table__,
            id=workspace_id,
            slug=f"ws-{workspace_id}",
            name=f"Workspace {workspace_id}",
            newcomer_scope=newcomer_scope,
        )
        return workspace_id

    def tournament(self, tournament_id: int, *, workspace_id: int, start_date: datetime | None) -> int:
        self.insert(
            Tournament.__table__,
            id=tournament_id,
            workspace_id=workspace_id,
            name=f"Tournament {tournament_id}",
            slug=f"tournament-{tournament_id}",
            start_date=start_date,
        )
        return tournament_id

    def team(self, tournament_id: int) -> int:
        team_id = self._id()
        self.insert(
            Team.__table__,
            id=team_id,
            tournament_id=tournament_id,
            name=f"Team {team_id}",
            balancer_name=f"Team {team_id}",
        )
        return team_id

    def member(self, user_id: int, *, workspace_id: int) -> int:
        member_id = self._id()
        self.insert(
            WorkspaceMember.__table__,
            id=member_id,
            workspace_id=workspace_id,
            player_id=user_id,
        )
        return member_id

    def player(
        self,
        tournament_id: int,
        *,
        user_id: int,
        workspace_id: int,
        role: HeroClass | None = HeroClass.tank,
        is_substitution: bool = False,
    ) -> int:
        team_id = self.team(tournament_id)
        member_id = self.member(user_id, workspace_id=workspace_id)
        player_id = self._id()
        self.insert(
            Player.__table__,
            id=player_id,
            tournament_id=tournament_id,
            team_id=team_id,
            workspace_member_id=member_id,
            name=f"Player {player_id}",
            role=role,
            rank=3000,
            is_substitution=is_substitution,
        )
        return player_id


def _current(tournament_id: int, *, workspace_id: int, start_date: datetime | None) -> SimpleNamespace:
    return SimpleNamespace(id=tournament_id, workspace_id=workspace_id, start_date=start_date)


class _DatabaseTestCase(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.db = _Fixture()

    def tearDown(self) -> None:
        self.db.close()


class EmptyInputTests(_DatabaseTestCase):
    async def test_empty_user_ids_short_circuits_without_a_query(self) -> None:
        current = _current(99, workspace_id=1, start_date=None)
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[])
        self.assertTrue(history.is_newcomer(1))  # empty history ⇒ trivially a newcomer
        self.assertEqual(frozenset(), history.experienced_user_ids)


class GlobalScopeTests(_DatabaseTestCase):
    async def test_platform_wide_history_counts_across_workspaces(self) -> None:
        self.db.workspace(1, newcomer_scope="global")
        self.db.workspace(2, newcomer_scope="global")
        self.db.tournament(10, workspace_id=1, start_date=datetime(2025, 1, 1, tzinfo=UTC))
        self.db.player(10, user_id=42, workspace_id=1)

        current = _current(20, workspace_id=2, start_date=datetime(2026, 1, 1, tzinfo=UTC))
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertFalse(history.is_newcomer(42))


class WorkspaceScopeTests(_DatabaseTestCase):
    async def test_workspace_scoped_history_ignores_other_workspaces(self) -> None:
        self.db.workspace(1, newcomer_scope="global")
        self.db.workspace(2, newcomer_scope="workspace")
        self.db.tournament(10, workspace_id=1, start_date=datetime(2025, 1, 1, tzinfo=UTC))
        self.db.player(10, user_id=42, workspace_id=1)

        current = _current(20, workspace_id=2, start_date=datetime(2026, 1, 1, tzinfo=UTC))
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        # A veteran of workspace 1 is a newcomer the first time they join
        # workspace 2, once workspace 2 opts into workspace-scoped history.
        self.assertTrue(history.is_newcomer(42))

    async def test_workspace_scoped_history_still_counts_same_workspace(self) -> None:
        self.db.workspace(1, newcomer_scope="workspace")
        self.db.tournament(10, workspace_id=1, start_date=datetime(2025, 1, 1, tzinfo=UTC))
        self.db.player(10, user_id=42, workspace_id=1)

        current = _current(20, workspace_id=1, start_date=datetime(2026, 1, 1, tzinfo=UTC))
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertFalse(history.is_newcomer(42))


class NullStartDateSentinelTests(_DatabaseTestCase):
    """Postgres tuple comparison breaks the moment either side is NULL -- these
    pin the ``COALESCE(start_date, _FAR_FUTURE)`` sentinel both directions."""

    async def test_dated_tournament_counts_as_earlier_than_an_undated_current_one(self) -> None:
        self.db.workspace(1)
        self.db.tournament(10, workspace_id=1, start_date=datetime(2020, 1, 1, tzinfo=UTC))
        self.db.player(10, user_id=42, workspace_id=1)

        # The current tournament has no start_date at all -- without the
        # sentinel, comparing against a real date would raise or misbehave.
        current = _current(20, workspace_id=1, start_date=None)
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertFalse(history.is_newcomer(42))

    async def test_undated_tournament_never_counts_as_earlier_despite_a_lower_id(self) -> None:
        self.db.workspace(1)
        # id=10 sorts before id=20 numerically, but its NULL start_date must
        # place it *after* any dated tournament -- including one created later
        # with a real, earlier-looking date.
        self.db.tournament(10, workspace_id=1, start_date=None)
        self.db.player(10, user_id=42, workspace_id=1)

        current = _current(20, workspace_id=1, start_date=datetime(2019, 1, 1, tzinfo=UTC))
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertTrue(history.is_newcomer(42))

    async def test_two_undated_tournaments_tie_break_on_id(self) -> None:
        self.db.workspace(1)
        self.db.tournament(10, workspace_id=1, start_date=None)
        self.db.player(10, user_id=42, workspace_id=1)

        current = _current(20, workspace_id=1, start_date=None)
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertFalse(history.is_newcomer(42))


class RoleScopeTests(_DatabaseTestCase):
    async def test_newcomer_role_is_independent_of_overall_newcomer_status(self) -> None:
        self.db.workspace(1)
        self.db.tournament(10, workspace_id=1, start_date=datetime(2025, 1, 1, tzinfo=UTC))
        self.db.player(10, user_id=42, workspace_id=1, role=HeroClass.tank)

        current = _current(20, workspace_id=1, start_date=datetime(2026, 1, 1, tzinfo=UTC))
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertFalse(history.is_newcomer(42))
        self.assertFalse(history.is_newcomer_role(42, HeroClass.tank))
        self.assertTrue(history.is_newcomer_role(42, HeroClass.support))


class SubstitutionCountsAsExperienceTests(_DatabaseTestCase):
    async def test_a_prior_substitution_row_counts_toward_future_newcomer_checks(self) -> None:
        self.db.workspace(1)
        self.db.tournament(10, workspace_id=1, start_date=datetime(2025, 1, 1, tzinfo=UTC))
        self.db.player(10, user_id=42, workspace_id=1, is_substitution=True)

        current = _current(20, workspace_id=1, start_date=datetime(2026, 1, 1, tzinfo=UTC))
        history = await load_prior_participation(self.db.shim, tournament=current, user_ids=[42])

        self.assertFalse(history.is_newcomer(42))
