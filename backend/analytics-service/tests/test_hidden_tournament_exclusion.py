"""Hidden tournaments must not enter the analytics timeline or its aggregates.

``Tournament.id`` is used across analytics-service as an ordinal season
timeline. The scrim feature (docs/plans/2026-08-12-scrim-rooms.md) introduces
one hidden ``Tournament`` container per workspace that holds rooms rather than a
season, so every timeline enumeration has to exclude it.

These tests run the *real* queries against a real SQL engine rather than
asserting on mocks: the claims under test ("the fold enumeration skips it",
"the performance aggregate yields zero rows for it") are properties of the
emitted SQL, and a mock session cannot falsify them. SQLite stands in for
Postgres because analytics-service has no DB fixture; each accommodation it
needs is documented where it is applied.
"""

from __future__ import annotations

import importlib
import os
import sys
import warnings
from datetime import UTC, datetime
from pathlib import Path
from unittest import IsolatedAsyncioTestCase

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "analytics-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("S3_ACCESS_KEY", "test")
os.environ.setdefault("S3_SECRET_KEY", "test")
os.environ.setdefault("S3_ENDPOINT_URL", "http://localhost")
os.environ.setdefault("S3_BUCKET_NAME", "test")

models = importlib.import_module("src.models")
analytics_service = importlib.import_module("src.services.analytics.service").analytics_service
splits = importlib.import_module("src.services.ml.training.splits")
backtest = importlib.import_module("src.services.ml.training.backtest")
enums = importlib.import_module("shared.core.enums")
analytics_flows = importlib.import_module("src.services.analytics.flows")


# Only ``tournament`` carries Postgres-only column types among the tables these
# queries touch. Rendering them as JSON keeps the DDL SQLite-compatible without
# altering any column the queries read.
@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


# The tables reachable from the queries under test. Their foreign keys into
# tables outside this set (``players.user``, ``overwatch.map``, ``workspace``)
# are unenforced under SQLite, so those tables are deliberately not created.
TABLES = (
    models.Tournament.__table__,
    # ``Tournament.phase_schedule`` is ``lazy="selectin"``, so loading a
    # tournament through ``get_matches``' ``joinedload`` queries this table too.
    models.TournamentPhaseSchedule.__table__,
    models.Team.__table__,
    models.Player.__table__,
    models.WorkspaceMember.__table__,
    models.Encounter.__table__,
    models.Match.__table__,
    models.MatchStatistics.__table__,
    models.Standing.__table__,
)

WORKSPACE_ID = 1
ROLE = enums.HeroClass.damage
PERFORMANCE_POINTS = enums.LogStatsName.PerformancePoints

# ``get_analytics``'s ``team_standings`` CTE uses ``DISTINCT ON``, which SQLite
# ignores with a deprecation notice. Harmless here: the CTE is LEFT-joined, so
# at worst it duplicates standings rows for the *visible* tournament — it can
# never suppress a scrim row and so cannot manufacture a pass. Applied per call
# rather than at import because pytest resets the global filters per test.
DISTINCT_ON_NOTICE = "DISTINCT ON is currently supported only by the PostgreSQL dialect"


class _AsyncSessionShim:
    """Async facade over a synchronous ``Session``.

    The services await ``execute`` / ``scalar`` / ``scalars`` and nothing else,
    and no async SQLite driver is installed, so a sync session behind async
    methods runs the genuine statements without pulling in aiosqlite.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement):  # noqa: ANN001, ANN202
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=DISTINCT_ON_NOTICE, category=sa.exc.SADeprecationWarning)
            return self._session.execute(statement)

    async def scalar(self, statement):  # noqa: ANN001, ANN202
        return self._session.scalar(statement)

    async def scalars(self, statement):  # noqa: ANN001, ANN202
        return self._session.scalars(statement)


class _Fixture:
    """A throwaway in-memory database plus row builders for it."""

    def __init__(self) -> None:
        # StaticPool pins one connection: ``:memory:`` databases (including the
        # ATTACHed ones standing in for Postgres schemas) live and die with it.
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

    def tournament(self, tournament_id: int, *, is_hidden: bool = False, name: str | None = None) -> int:
        self.insert(
            models.Tournament.__table__,
            id=tournament_id,
            workspace_id=WORKSPACE_ID,
            name=name or f"Tournament {tournament_id}",
            slug=f"tournament-{tournament_id}",
            is_hidden=is_hidden,
            # ``AnalyticsMatch.time`` is a required datetime sourced from here.
            # A lazily provisioned scrim container has no start date, which is a
            # second way an unfiltered encounter range crashes the replay.
            start_date=datetime(2026, 1, tournament_id, tzinfo=UTC),
        )
        return tournament_id

    def team(self, tournament_id: int, name: str) -> int:
        team_id = self._id()
        self.insert(
            models.Team.__table__,
            id=team_id,
            tournament_id=tournament_id,
            name=name,
            balancer_name=name,
        )
        return team_id

    def member(self, user_id: int) -> int:
        member_id = self._id()
        self.insert(
            models.WorkspaceMember.__table__,
            id=member_id,
            workspace_id=WORKSPACE_ID,
            player_id=user_id,
        )
        return member_id

    def player(self, tournament_id: int, team_id: int, member_id: int, *, name: str, rank: int = 3000) -> int:
        player_id = self._id()
        self.insert(
            models.Player.__table__,
            id=player_id,
            tournament_id=tournament_id,
            team_id=team_id,
            workspace_member_id=member_id,
            name=name,
            role=ROLE,
            rank=rank,
            is_substitution=False,
            is_newcomer=False,
            is_newcomer_role=False,
        )
        return player_id

    def encounter(self, tournament_id: int, home_team_id: int, away_team_id: int) -> int:
        encounter_id = self._id()
        self.insert(
            models.Encounter.__table__,
            id=encounter_id,
            tournament_id=tournament_id,
            name="Encounter",
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            home_score=2,
            away_score=1,
            round=1,
        )
        return encounter_id

    def match(self, encounter_id: int, home_team_id: int, away_team_id: int) -> int:
        match_id = self._id()
        self.insert(
            models.Match.__table__,
            id=match_id,
            encounter_id=encounter_id,
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            home_score=2,
            away_score=1,
            map_id=1,
        )
        return match_id

    def performance_points(self, match_id: int, team_id: int, user_id: int, value: float) -> None:
        self.insert(
            models.MatchStatistics.__table__,
            id=self._id(),
            match_id=match_id,
            team_id=team_id,
            user_id=user_id,
            round=0,
            hero_id=None,
            name=PERFORMANCE_POINTS,
            value=value,
        )

    def roster(self, tournament_id: int, *, user_id: int, label: str) -> dict[str, int]:
        """A tournament with two rostered teams, an encounter and one stat row.

        Both sides get a player: the OpenSkill replay rates the two rosters
        against each other and rejects an empty side, so a half-rostered
        encounter would fail for the same reason a scrim room does and mask
        what these tests are measuring.
        """
        home = self.team(tournament_id, f"{label} home")
        away = self.team(tournament_id, f"{label} away")
        home_member = self.member(user_id)
        away_member = self.member(user_id + 1)
        player = self.player(tournament_id, home, home_member, name=f"{label} home player")
        self.player(tournament_id, away, away_member, name=f"{label} away player")
        encounter = self.encounter(tournament_id, home, away)
        match = self.match(encounter, home, away)
        self.performance_points(match, home, user_id, 42.0)
        return {"home": home, "away": away, "player": player, "encounter": encounter}

    def scrim_room(self, tournament_id: int, label: str = "scrim") -> dict[str, int]:
        """A scrim room exactly as §4.1 provisions it: teams but no ``Player`` rows."""
        home = self.team(tournament_id, f"{label} home")
        away = self.team(tournament_id, f"{label} away")
        encounter = self.encounter(tournament_id, home, away)
        return {"home": home, "away": away, "encounter": encounter}


class _DatabaseTestCase(IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.db = _Fixture()

    def tearDown(self) -> None:
        self.db.close()


class HiddenTournamentTimelineTests(_DatabaseTestCase):
    """The ordinal ``Tournament.id`` timeline must skip hidden containers."""

    async def test_fold_enumeration_skips_hidden_tournament_inside_the_range(self) -> None:
        self.db.tournament(1)
        self.db.tournament(2, is_hidden=True, name="Scrims")
        self.db.tournament(3)

        ids = await splits.tournament_ids_up_to(self.db.shim, 3)

        self.assertEqual([1, 3], ids)

    async def test_fold_enumeration_still_returns_visible_tournaments_only_when_hidden_is_last(self) -> None:
        self.db.tournament(1)
        self.db.tournament(2)
        self.db.tournament(3, is_hidden=True, name="Scrims")

        ids = await splits.tournament_ids_up_to(self.db.shim, 3)

        # A trailing hidden container must not become the cutoff fold either.
        self.assertEqual([1, 2], ids)

    async def test_latest_tournament_id_ignores_hidden_tournament_with_highest_id(self) -> None:
        self.db.tournament(1)
        self.db.tournament(2)
        self.db.tournament(3, is_hidden=True, name="Scrims")

        latest = await backtest._latest_tournament_id(self.db.shim)

        self.assertEqual(2, latest)

    async def test_lookback_window_does_not_spend_a_slot_on_a_hidden_tournament(self) -> None:
        # look_back=2 over ids 1,2,3 where 3 is hidden: the window must reach
        # back to 1, not stop at 2 because the container consumed a slot.
        self.db.tournament(1)
        self.db.tournament(2)
        self.db.tournament(3, is_hidden=True, name="Scrims")

        start = await analytics_service.lookback_start_tournament_id(self.db.shim, 3, 2)

        self.assertEqual(1, start)


class ScrimAggregateIsolationTests(_DatabaseTestCase):
    """Pins the design's isolation claim for the analytics aggregate.

    ``get_analytics`` has no ``is_hidden`` filter and is not getting one: the
    design (§5) argues a scrim is inert there because its teams carry no
    ``Player`` rows while the aggregate inner-joins ``Player``. That is a claim
    about a join graph, so it is tested, not asserted.
    """

    async def test_hidden_tournament_without_player_rows_contributes_no_rows(self) -> None:
        self.db.tournament(1)
        real = self.db.roster(1, user_id=100, label="real")
        scrims = self.db.tournament(2, is_hidden=True, name="Scrims")
        scrim = self.db.scrim_room(scrims)

        rows = await analytics_service.get_analytics(self.db.shim)

        self.assertEqual({1}, {row["tournament_id"] for row in rows})
        self.assertIn(real["player"], {row["player_id"] for row in rows})
        self.assertEqual(
            set(),
            {row["team_id"] for row in rows} & {scrim["home"], scrim["away"]},
            "a scrim team leaked into the analytics aggregate",
        )
        self.assertEqual(
            [],
            [row for row in rows if row["tournament_id"] == scrims],
            "the scrim container leaked into the analytics aggregate",
        )

    async def test_scrim_encounter_does_not_inflate_the_rostered_rows(self) -> None:
        # The match-count and team-count CTEs group by team / tournament without
        # joining Player, so a scrim room does produce CTE rows. Prove they
        # cannot reach the output by adding one and checking the real players'
        # counters are byte-for-byte unchanged.
        self.db.tournament(1)
        self.db.roster(1, user_id=100, label="real")
        counters = ("wins", "losses", "match_count", "performance_points", "team_count")
        before = [{key: row[key] for key in counters} for row in await analytics_service.get_analytics(self.db.shim)]
        self.assertTrue(before)

        scrims = self.db.tournament(2, is_hidden=True, name="Scrims")
        self.db.scrim_room(scrims)

        after = [{key: row[key] for key in counters} for row in await analytics_service.get_analytics(self.db.shim)]

        self.assertEqual(before, after)

    async def test_player_rows_are_the_only_thing_holding_the_isolation(self) -> None:
        # The counter-test: the same hidden container leaks the moment one of
        # its teams gains a Player row. This is why §4.1 provisions teams
        # without players, and why a future scrim roster feature cannot rely on
        # ``is_hidden`` alone for analytics isolation.
        self.db.tournament(1)
        self.db.roster(1, user_id=100, label="real")
        scrims = self.db.tournament(2, is_hidden=True, name="Scrims")
        scrim = self.db.scrim_room(scrims)
        member = self.db.member(200)
        self.db.player(scrims, scrim["home"], member, name="scrim captain")

        rows = await analytics_service.get_analytics(self.db.shim)

        leaked = [r for r in rows if r["tournament_id"] == scrims]
        self.assertEqual(
            1,
            len(leaked),
            "expected the aggregate to admit a hidden tournament once it has a Player row; "
            "if this fails the isolation rests on something other than Player rows",
        )


class OpenSkillReplayIsolationTests(_DatabaseTestCase):
    """A scrim encounter must never reach the OpenSkill replay.

    The design (§5) expected every consumer downstream of an encounter range to
    be inert because scrim teams carry no ``Player`` rows. ``get_matches`` is
    the exception: it reaches encounters through ``joinedload``, an OUTER join,
    so a Player-less scrim encounter arrives with two real teams and empty
    rosters. ``prepare_openskill_data`` then rates two empty sides and raises.
    Hence the ``is_hidden`` filter on ``get_matches`` -- these tests hold it in
    place.
    """

    def _timeline_with_a_scrim_in_the_middle(self) -> int:
        self.db.tournament(1)
        self.db.roster(1, user_id=100, label="first")
        scrims = self.db.tournament(2, is_hidden=True, name="Scrims")
        self.db.scrim_room(scrims)
        self.db.tournament(3)
        self.db.roster(3, user_id=200, label="second")
        return scrims

    def test_plackett_luce_rejects_the_empty_sides_a_scrim_encounter_produces(self) -> None:
        # Pins the failure mode the filter prevents, independently of the query:
        # this is the exact call ``prepare_openskill_data`` makes for an
        # encounter whose two teams have no players.
        pl = analytics_flows.get_plackett_luce()

        with self.assertRaises(ValueError):
            pl.rate([[], []], scores=[2, 1])

    async def test_encounter_range_read_skips_the_hidden_container(self) -> None:
        scrims = self._timeline_with_a_scrim_in_the_middle()

        encounters = await analytics_service.get_matches(self.db.shim, 1, 3)

        self.assertEqual([1, 3], sorted({int(e.tournament_id) for e in encounters}))
        self.assertNotIn(scrims, {int(e.tournament_id) for e in encounters})

    async def test_openskill_replay_survives_a_scrim_container_in_the_window(self) -> None:
        self._timeline_with_a_scrim_in_the_middle()
        encounters = await analytics_service.get_matches(self.db.shim, 1, 3)
        teams = await analytics_service.get_teams_with_players(self.db.shim, 3)

        # ``prepare_openskill_data`` ignores its ``df`` argument entirely.
        _agents, ratings, replayed = analytics_flows.prepare_openskill_data(
            pd.DataFrame(),
            analytics_flows.get_plackett_luce(),
            teams,
            encounters,
        )

        self.assertEqual(2, len(replayed), "both rostered encounters should be replayed")
        self.assertEqual({1, 3}, {m.tournament_id for m in replayed})
        self.assertTrue(ratings, "the replay must produce ratings for the rostered players")
