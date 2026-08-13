"""Deleting an encounter must delete its series, not orphan it.

``Match.encounter_id`` is NOT NULL. ``Encounter.matches`` shipped as a bare
``relationship()``, and SQLAlchemy's default cascade de-associates children when
the parent goes -- it LOADS the collection during flush and emits
``UPDATE matches.match SET encounter_id = NULL``. Against a NOT NULL column that
is a NotNullViolationError, so ``admin.encounter.delete_encounter`` could not
delete any encounter that had ever been played.

The column already carries ``ON DELETE CASCADE`` (and so does every ``match_id``
child of it), so the fix is ``passive_deletes=True``: leave the rows to the
database. These tests pin both halves -- the flush emits no de-association, and
the database cascade it now relies on actually exists.

Run against a real (SQLite) engine rather than a mock: the defect was in what
the flush EMITS, which only a flush can show.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import TestCase

import sqlalchemy as sa
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_root))

os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: E402

from shared.core import enums  # noqa: E402
from shared.models.matches.match import Match, MatchEvent, MatchKillFeed, MatchStatistics  # noqa: E402
from shared.models.tournament.encounter import Encounter  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(sa.BigInteger, "sqlite")
def _compile_bigint_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "INTEGER"


ENCOUNTER_ID = 500
TOURNAMENT_ID = 7
HOME_TEAM_ID = 11
AWAY_TEAM_ID = 12
MAP_ID = 3


class EncounterMatchDeleteCascadeTests(TestCase):
    def setUp(self) -> None:
        # Only the two tables under test. SQLite does not validate a foreign key's
        # target at CREATE time and enforcement is off by default, so the rest of
        # the schema each one references does not need to exist.
        tables = [Encounter.__table__, Match.__table__]
        self.engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.begin() as conn:
            for schema in sorted({table.schema for table in tables if table.schema}):
                conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
            for table in tables:
                table.create(conn)

        self.statements: list[str] = []

        @sa.event.listens_for(self.engine, "before_cursor_execute")
        def _record(_conn, _cursor, statement, _params, _context, _executemany):  # noqa: ANN001, ANN202
            self.statements.append(" ".join(statement.split()))

        self.session = Session(self.engine)
        self.addCleanup(self.session.close)

        self.session.execute(
            sa.insert(Encounter.__table__).values(
                id=ENCOUNTER_ID,
                name="Grand Final",
                tournament_id=TOURNAMENT_ID,
                home_team_id=HOME_TEAM_ID,
                away_team_id=AWAY_TEAM_ID,
                home_score=2,
                away_score=1,
                round=1,
                best_of=3,
                closeness=0.0,
                has_logs=True,
                status=enums.EncounterStatus.COMPLETED,
                result_status=enums.EncounterResultStatus.NONE,
            )
        )
        for match_id in (900, 901):
            self.session.execute(
                sa.insert(Match.__table__).values(
                    id=match_id,
                    encounter_id=ENCOUNTER_ID,
                    map_id=MAP_ID,
                    home_team_id=HOME_TEAM_ID,
                    away_team_id=AWAY_TEAM_ID,
                    home_score=2,
                    away_score=1,
                    source="log_parser",
                )
            )
        self.session.commit()
        self.statements.clear()

    def _delete_the_encounter(self) -> None:
        """Exactly what ``admin.encounter.delete_encounter`` does: select the row
        without its series, delete it, flush. The collection being UNLOADED is the
        point -- the default cascade loads it here in order to null it out."""
        encounter = self.session.scalar(sa.select(Encounter).where(Encounter.id == ENCOUNTER_ID))
        assert encounter is not None
        self.session.delete(encounter)
        self.session.flush()

    def test_flush_never_de_associates_a_match(self) -> None:
        self._delete_the_encounter()

        offenders = [s for s in self.statements if s.startswith("UPDATE matches.match")]
        self.assertEqual(
            [],
            offenders,
            msg="the default cascade nulls Match.encounter_id, which is NOT NULL",
        )

    def test_flush_leaves_the_series_to_the_database(self) -> None:
        self._delete_the_encounter()

        self.assertTrue(
            any(s.startswith("DELETE FROM tournament.encounter") for s in self.statements),
            msg=f"expected the parent delete, got {self.statements}",
        )
        # ``passive_deletes`` means SQLAlchemy does not read the series at all.
        self.assertEqual(
            [],
            [s for s in self.statements if s.startswith("SELECT") and "matches.match" in s],
            msg="the series should not be loaded just to be deleted",
        )

    def test_the_database_cascade_it_relies_on_exists(self) -> None:
        """``passive_deletes`` is only safe while the DB does the work — for the
        match itself and for everything hanging off it."""
        encounter_fks = list(Match.__table__.c.encounter_id.foreign_keys)
        self.assertFalse(Match.__table__.c.encounter_id.nullable)
        self.assertEqual(["CASCADE"], [fk.ondelete for fk in encounter_fks])

        for model in (MatchStatistics, MatchKillFeed, MatchEvent):
            with self.subTest(model=model.__name__):
                fks = list(model.__table__.c.match_id.foreign_keys)
                self.assertEqual(
                    ["CASCADE"],
                    [fk.ondelete for fk in fks],
                    msg=f"{model.__name__}.match_id would be orphaned by the DB cascade",
                )
