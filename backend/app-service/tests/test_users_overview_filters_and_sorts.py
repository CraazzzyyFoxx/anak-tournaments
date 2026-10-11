"""Filter and ORDER BY contracts of the ``/users`` overview surface.

Compile-shape tests (no live DB, like ``test_users_overview_workspace_scope``):
every assertion is about the SQL the query layer emits, because the numbers two
shapes return are identical right up to the point where one of them is wrong —
a sort that ignores the workspace, a winrate that lets a 2-map player top the
table, or a division chip that zeroes every other chip's count.
"""

from __future__ import annotations

import asyncio
from unittest import TestCase

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from shared.division_grid import DEFAULT_GRID
from src import models, schemas
from src.services.user.queries.overview import overview as overview_queries

WORKSPACE = 7


def _sql(statement) -> str:
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


def _order_by_sql(sort_key: str, *, descending: bool, workspace_id: int | None, min_encounters: int = 20) -> str:
    terms = overview_queries._overview_order_by(
        sort_key,
        descending=descending,
        grid=DEFAULT_GRID,
        workspace_id=workspace_id,
        min_encounters=min_encounters,
    )
    return _sql(sa.select(models.User.id).order_by(*terms))


class _Rows:
    def all(self):
        return []

    def unique(self):
        return self

    def scalar_one(self):
        return 3

    def scalars(self):
        return self


class _CaptureSession:
    """Records every statement and returns an empty-but-non-zero result."""

    def __init__(self) -> None:
        self.statements: list = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Rows()

    def sql(self, index: int) -> str:
        return _sql(self.statements[index])


class OverviewSortTests(TestCase):
    def test_every_sort_is_scoped_to_the_workspace(self) -> None:
        # The displayed counts are workspace-scoped; a sort that is not orders
        # the page by numbers the page never shows.
        for sort_key in ("tournaments_count", "avg_placement", "best_placement", "winrate"):
            with self.subTest(sort=sort_key):
                self.assertIn(
                    f"tournament.workspace_id = {WORKSPACE}",
                    _order_by_sql(sort_key, descending=True, workspace_id=WORKSPACE),
                )

    def test_achievements_sort_is_scoped_through_the_effective_rows(self) -> None:
        sql = _order_by_sql("achievements_count", descending=True, workspace_id=WORKSPACE)
        self.assertIn(f"workspace_id = {WORKSPACE}", sql)

    def test_all_workspaces_sort_has_no_workspace_predicate(self) -> None:
        self.assertNotIn("workspace_id =", _order_by_sql("tournaments_count", descending=True, workspace_id=None))

    def test_winrate_orders_thin_samples_last_in_both_directions(self) -> None:
        for descending in (True, False):
            with self.subTest(descending=descending):
                sql = _order_by_sql("winrate", descending=descending, workspace_id=WORKSPACE, min_encounters=20)
                # The sample-size group always sorts ascending (qualified first),
                # whichever way the winrate column itself is pointed.
                self.assertIn(">= 20) THEN 0 ELSE 1 END ASC", sql.replace("\n", " "))
                self.assertIn("DESC NULLS LAST" if descending else "ASC NULLS LAST", sql)

    def test_winrate_sample_size_threshold_follows_min_encounters(self) -> None:
        sql = _order_by_sql("winrate", descending=True, workspace_id=WORKSPACE, min_encounters=50)
        self.assertIn(">= 50", sql)
        self.assertNotIn(">= 20", sql)

    def test_winrate_is_a_float_ratio_that_is_null_without_maps(self) -> None:
        sql = _order_by_sql("winrate", descending=True, workspace_id=WORKSPACE)
        self.assertIn("nullif", sql.lower())
        self.assertIn("NULLS LAST", sql)

    def test_best_placement_ignores_zero_and_sorts_nulls_last(self) -> None:
        for descending in (True, False):
            with self.subTest(descending=descending):
                sql = _order_by_sql("best_placement", descending=descending, workspace_id=WORKSPACE)
                self.assertIn("overall_position > 0", sql)
                self.assertIn("NULLS LAST", sql)

    def test_plain_column_sorts_keep_the_id_tiebreaker(self) -> None:
        sql = _order_by_sql("name", descending=False, workspace_id=WORKSPACE)
        self.assertTrue(sql.rstrip().endswith('players."user".id ASC'))


class OverviewFilterTests(TestCase):
    def _overview_sql(self, **params) -> str:
        session = _CaptureSession()
        asyncio.run(
            overview_queries.get_overview_users(
                session,
                schemas.UserOverviewParams(**params),
                DEFAULT_GRID,
                workspace_id=WORKSPACE,
            )
        )
        return session.sql(0)

    def test_has_logs_filters_the_page_and_the_total(self) -> None:
        session = _CaptureSession()
        asyncio.run(
            overview_queries.get_overview_users(
                session,
                schemas.UserOverviewParams(sort="name", has_logs=True),
                DEFAULT_GRID,
                workspace_id=WORKSPACE,
            )
        )
        # [0] is the page, [1] the total — a total that ignores the filter
        # paginates over a population the page does not contain.
        for index in (0, 1):
            self.assertIn("matches.statistics", session.sql(index))

    def test_has_logs_defaults_off(self) -> None:
        self.assertNotIn("matches.statistics", self._overview_sql(sort="name"))

    def test_divisions_filter_the_page(self) -> None:
        sql = self._overview_sql(sort="name", divisions=[3, 5])
        self.assertIn("player.rank", sql)
        self.assertIn(" OR ", sql)

    def test_cached_id_order_is_skipped_once_a_filter_is_on(self) -> None:
        # The cached order is population-wide; any filter makes it the wrong set,
        # so the request must fall back to a real paged query (LIMIT).
        for params in (
            {"sort": "winrate", "divisions": [3]},
            {"sort": "winrate", "has_logs": True},
            {"sort": "winrate", "query": "cra", "fields": ["name"]},
        ):
            with self.subTest(params=params):
                self.assertIn("LIMIT", self._overview_sql(**params))

    def test_cached_order_key_separates_min_encounters(self) -> None:
        # min_encounters changes the winrate order, so it has to be in the key.
        session = _CaptureSession()

        async def _run() -> None:
            for min_encounters in (20, 20, 50):
                await overview_queries._overview_ordered_ids(
                    session,
                    workspace_id=WORKSPACE,
                    sort_key="winrate",
                    descending=True,
                    min_encounters=min_encounters,
                    grid=DEFAULT_GRID,
                )

        asyncio.run(_run())
        self.assertEqual(2, len(session.statements))


class OverviewPageAggregateTests(TestCase):
    """The per-page values the row shows, batched for the whole page."""

    def test_map_records_use_union_all_sides_and_dedupe_encounters(self) -> None:
        session = _CaptureSession()
        asyncio.run(overview_queries.get_overview_map_records(session, [7], workspace_id=WORKSPACE))
        sql = session.sql(0)

        # `home_team_id = id OR away_team_id = id` uses neither FK index.
        self.assertIn("UNION ALL", sql)
        self.assertNotIn("home_team_id = tournament.team.id OR", sql)
        # A user rostered twice on one team must not double its maps.
        self.assertIn("DISTINCT", sql)
        # encounters_played counts encounters that have a result.
        self.assertIn("count(DISTINCT", sql)
        self.assertIn(f"tournament.workspace_id = {WORKSPACE}", sql)

    def test_last_active_prefers_end_date_and_counts_unfinished_tournaments(self) -> None:
        session = _CaptureSession()
        asyncio.run(overview_queries.get_overview_last_active(session, [7], workspace_id=WORKSPACE))
        sql = session.sql(0)

        self.assertIn("max(coalesce(", sql)
        self.assertIn("end_date", sql)
        self.assertIn("start_date", sql)
        # Same shape as the active_last_30d KPI: league rows out, unfinished in.
        self.assertIn("is_league", sql)
        self.assertNotIn("is_finished", sql)

    def test_best_placement_comes_from_the_averages_pass_and_ignores_zero(self) -> None:
        session = _CaptureSession()
        asyncio.run(overview_queries.get_overview_averages(session, [7], workspace_id=WORKSPACE))
        sql = " ".join(session.sql(index) for index in range(len(session.statements)))
        self.assertIn("overall_position > 0", sql)


class OverviewStatsTests(TestCase):
    def _stats_statements(self, **kwargs) -> _CaptureSession:
        session = _CaptureSession()
        asyncio.run(
            overview_queries.get_overview_stats(
                session,
                role=None,
                divisions=kwargs.pop("divisions", []),
                has_logs=kwargs.pop("has_logs", False),
                query=None,
                grid=DEFAULT_GRID,
                workspace_id=kwargs.pop("workspace_id", None),
            )
        )
        return session

    def test_division_counts_ignore_the_division_filter_itself(self) -> None:
        session = self._stats_statements(divisions=[5], has_logs=True)
        candidates_sql = session.sql(0)
        counts_sql = session.sql(-1)

        # The filtered candidate set honours the chips...
        self.assertIn("IN (5)", candidates_sql)
        # ...the chip counts are computed from the set before them, or picking
        # one division would report 0 for every other chip.
        self.assertIn("overview_division_candidates", counts_sql)
        self.assertNotIn("overview_candidates", counts_sql)
        self.assertNotIn("IN (5)", counts_sql)
        # The other filters still apply to the counts.
        self.assertIn("matches.statistics", counts_sql)

    def test_stats_candidates_honour_has_logs(self) -> None:
        session = self._stats_statements(has_logs=True)
        self.assertIn("matches.statistics", session.sql(0))

    def test_stats_candidates_are_unfiltered_by_default(self) -> None:
        session = self._stats_statements()
        self.assertNotIn("EXISTS", session.sql(0))
