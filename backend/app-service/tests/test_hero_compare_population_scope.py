"""The hero-compare baseline must be resolved in SQL, not shipped through Python.

``get_hero_compare`` used to resolve the cohort itself, get ~560 ``(id, name)`` rows
back, and hand the ids straight into ``get_users_hero_compare_stats`` as an ``IN``
list — so the statistics statement
arrived with 584 bind parameters. It timed out in production
(``QueryCanceledError: canceling statement due to statement timeout``), and it was
slow twice over: the planner cannot estimate selectivity through a list that long,
and under pgBouncer (``prepared_statement_cache_size = 0``) the plan is rebuilt on
every call — on a statement whose text changes with the population size, so nothing
is ever reused.

The population is now a subquery. The only thing that must not change is WHICH
users it covers, so that is what these tests pin, against a real (SQLite) database
and through ``compare_hero_candidates_select`` itself rather than a re-stated
predicate. Each exclusion below is a clause someone added on purpose:
substitutions, unfinished tournaments and leagues are all out.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from unittest import TestCase

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "app-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from sqlalchemy.dialects.postgresql import ARRAY, JSONB  # noqa: E402

from shared.division_grid import DivisionGrid  # noqa: E402
from src import models  # noqa: E402
from src.core import enums  # noqa: E402
from src.services.user.queries import _scope  # noqa: E402
from src.services.user.queries.compare import compare as compare_queries  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(sa.BigInteger, "sqlite")
def _compile_bigint_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "INTEGER"


TOURNAMENT = 84
OTHER_TOURNAMENT = 85
UNFINISHED = 90
LEAGUE = 91
WORKSPACE = 1
ROLE = enums.HeroClass.damage
OTHER_ROLE = enums.HeroClass.support

# One user per reason to be in or out of the cohort.
QUALIFIES = 10
WRONG_ROLE = 11
IS_SUBSTITUTE = 12
IN_UNFINISHED = 13
IN_LEAGUE = 14
OTHER_TOURNAMENT_ONLY = 15
NEVER_PLAYED = 16

_ROSTER = (
    (QUALIFIES, TOURNAMENT, ROLE, False),
    (WRONG_ROLE, TOURNAMENT, OTHER_ROLE, False),
    (IS_SUBSTITUTE, TOURNAMENT, ROLE, True),
    (IN_UNFINISHED, UNFINISHED, ROLE, False),
    (IN_LEAGUE, LEAGUE, ROLE, False),
    (OTHER_TOURNAMENT_ONLY, OTHER_TOURNAMENT, ROLE, False),
)

_FILTER_SETS = (
    {"role": ROLE, "div_min": None, "div_max": None, "tournament_id": TOURNAMENT},
    {"role": None, "div_min": None, "div_max": None, "tournament_id": TOURNAMENT},
    {"role": ROLE, "div_min": None, "div_max": None, "tournament_id": None},
    {"role": None, "div_min": None, "div_max": None, "tournament_id": None},
)


def _grid() -> DivisionGrid:
    return DivisionGrid(version_id=17, tiers=())


class HeroCompareBaselineScopeTests(TestCase):
    def setUp(self) -> None:
        tables = [
            models.User.__table__,
            models.WorkspaceMember.__table__,
            models.Tournament.__table__,
            models.Player.__table__,
        ]
        self.engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.begin() as conn:
            for schema in sorted({t.schema for t in tables if t.schema}):
                conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
            for table in tables:
                table.create(conn)
        self.session = Session(self.engine)
        self.addCleanup(self.session.close)

        for tournament_id, finished, league in (
            (TOURNAMENT, True, False),
            (OTHER_TOURNAMENT, True, False),
            (UNFINISHED, False, False),
            (LEAGUE, True, True),
        ):
            self.session.execute(
                sa.insert(models.Tournament.__table__).values(
                    id=tournament_id,
                    workspace_id=WORKSPACE,
                    name=f"T{tournament_id}",
                    is_finished=finished,
                    is_league=league,
                )
            )
        for user_id in (*(row[0] for row in _ROSTER), NEVER_PLAYED):
            self.session.execute(sa.insert(models.User.__table__).values(id=user_id, name=f"user{user_id}"))
            self.session.execute(
                sa.insert(models.WorkspaceMember.__table__).values(
                    id=user_id, workspace_id=WORKSPACE, player_id=user_id
                )
            )
        for user_id, tournament_id, role, substitution in _ROSTER:
            self.session.execute(
                sa.insert(models.Player.__table__).values(
                    id=user_id,
                    name=f"user{user_id}",
                    rank=100,
                    tournament_id=tournament_id,
                    workspace_member_id=user_id,
                    team_id=1,
                    role=role,
                    is_substitution=substitution,
                )
            )
        self.session.commit()

    def _candidates(self, **filters: object) -> set[int]:
        """Run the real helper the statement embeds."""
        select = compare_queries.compare_hero_candidates_select(user_ids=None, grid=_grid(), **filters)  # type: ignore[arg-type]
        return {int(row[0]) for row in self.session.execute(select)}

    def _population(self, **filters: object) -> set[int]:
        """The set the caller used to resolve for itself — what must not change."""
        query = sa.select(models.User.id)
        if any(value is not None for value in filters.values()):
            query = query.where(
                _scope._compare_user_scope_exists(  # noqa: SLF001 - the predicate that function applies
                    models.User.id,
                    grid=_grid(),
                    **filters,  # type: ignore[arg-type]
                )
            )
        return {int(row[0]) for row in self.session.execute(query)}

    def test_the_cohort_excludes_every_row_it_is_meant_to(self) -> None:
        self.assertEqual({QUALIFIES}, self._candidates(**_FILTER_SETS[0]))

    def test_a_role_only_cohort_spans_tournaments_but_not_leagues_or_unfinished(self) -> None:
        self.assertEqual({QUALIFIES, OTHER_TOURNAMENT_ONLY}, self._candidates(**_FILTER_SETS[2]))

    def test_no_filters_means_every_user_including_one_who_never_played(self) -> None:
        expected = {row[0] for row in _ROSTER} | {NEVER_PLAYED}
        self.assertEqual(expected, self._candidates(**_FILTER_SETS[3]))

    def test_the_subquery_selects_exactly_the_population_it_replaced(self) -> None:
        for filters in _FILTER_SETS:
            with self.subTest(**filters):
                self.assertEqual(self._population(**filters), self._candidates(**filters))

    def test_an_explicit_list_is_still_honoured(self) -> None:
        self.assertEqual(
            {QUALIFIES, NEVER_PLAYED},
            {
                int(row[0])
                for row in self.session.execute(
                    compare_queries.compare_hero_candidates_select(
                        user_ids=[QUALIFIES, NEVER_PLAYED],
                        role=ROLE,
                        div_min=None,
                        div_max=None,
                        tournament_id=TOURNAMENT,
                        grid=_grid(),
                    )
                )
            },
            msg="an explicit list must win over the cohort filters, unchanged",
        )

    def test_the_statement_no_longer_carries_a_parameter_per_user(self) -> None:
        """The regression itself: 584 bind parameters is what timed out."""

        def bind_params(user_ids: list[int] | None) -> int:
            sql = str(
                compare_queries._users_hero_compare_query_v2(  # noqa: SLF001 - builder under test
                    user_ids=user_ids,
                    hero_id=None,
                    map_id=None,
                    stats=[enums.LogStatsName.Eliminations],
                    role=ROLE,
                    div_min=None,
                    div_max=None,
                    tournament_id=TOURNAMENT,
                    grid=_grid(),
                ).compile(dialect=postgresql.dialect(), compile_kwargs={"render_postcompile": True})
            )
            return len(set(re.findall(r"%\(([^)]+)\)s", sql)))

        with_list = bind_params(list(range(1000, 1560)))
        with_subquery = bind_params(None)

        self.assertGreater(with_list, 500, msg="fixture no longer reproduces the shape that timed out")
        self.assertLess(
            with_subquery,
            50,
            msg=f"the population is still travelling as bind parameters ({with_subquery})",
        )
