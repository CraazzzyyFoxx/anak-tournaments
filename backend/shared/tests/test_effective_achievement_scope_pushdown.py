"""Narrowing effective achievement rows must not change which rows come out.

``build_effective_achievement_rows_subquery`` unrestricted scans every evaluation
result and grant in the database, then evaluates the correlated revoke
``NOT EXISTS`` against each before grouping. The compare page built it that way and
met its cohort only at a later join — which cannot be pushed through the subquery's
GROUP BY — so every compare call paid for the whole table. It timed out
(``QueryCanceledError``, OWT-TOURNAMENTS-ZS / 21T).

The cohort is now passed in, and may be a SELECTABLE rather than a list (a list is
the other pathology: 560 bind parameters). Joining a unique key and filtering by
membership in it are the same operation, so this is meant to be a pure
optimization. These tests prove that on a real (SQLite) database, including across
the revoke-precedence rules — global beats tournament beats match — which are the
part a careless narrowing would break.
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

from shared.models.achievements.achievement import (  # noqa: E402
    AchievementEvaluationResult,
    AchievementOverride,
    AchievementOverrideAction,
)
from shared.models.tenancy.workspace import WorkspaceMember  # noqa: E402
from shared.services.achievement_effective import build_effective_achievement_rows_subquery  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(ARRAY, "sqlite")
def _compile_array_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "JSON"


@compiles(sa.BigInteger, "sqlite")
def _compile_bigint_sqlite(type_, compiler, **kw):  # noqa: ANN001, ANN003, ANN202
    return "INTEGER"


WORKSPACE = 1
IN_COHORT = (10, 11)
OUT_OF_COHORT = (20, 21)
TOURNAMENT = 84
OTHER_TOURNAMENT = 85
MATCH = 900


class EffectiveAchievementScopeTests(TestCase):
    def setUp(self) -> None:
        tables = [
            WorkspaceMember.__table__,
            AchievementEvaluationResult.__table__,
            AchievementOverride.__table__,
        ]
        self.engine = sa.create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.begin() as conn:
            for schema in sorted({t.schema for t in tables if t.schema}):
                conn.exec_driver_sql(f"ATTACH DATABASE ':memory:' AS {schema}")
            for table in tables:
                table.create(conn)
        self.session = Session(self.engine)
        self.addCleanup(self.session.close)

        for player_id in (*IN_COHORT, *OUT_OF_COHORT):
            self.session.execute(
                sa.insert(WorkspaceMember.__table__).values(id=player_id, workspace_id=WORKSPACE, player_id=player_id)
            )

        # Every member qualifies for rules 1 and 2, plus a match-scoped rule 3.
        row_id = 1
        for player_id in (*IN_COHORT, *OUT_OF_COHORT):
            for rule_id, tournament_id, match_id in (
                (1, TOURNAMENT, None),
                (2, OTHER_TOURNAMENT, None),
                (3, TOURNAMENT, MATCH),
            ):
                self.session.execute(
                    sa.insert(AchievementEvaluationResult.__table__).values(
                        id=row_id,
                        achievement_rule_id=rule_id,
                        workspace_member_id=player_id,
                        tournament_id=tournament_id,
                        match_id=match_id,
                        rule_version=1,
                    )
                )
                row_id += 1

        # A grant nobody evaluated, and the three shapes of revoke: global,
        # tournament-scoped, match-scoped. One of each falls inside the cohort and
        # one outside, so a narrowing that mishandled precedence would diverge.
        override_id = 1
        for player_id, action, rule_id, tournament_id, match_id in (
            (IN_COHORT[0], AchievementOverrideAction.grant, 4, TOURNAMENT, None),
            (OUT_OF_COHORT[0], AchievementOverrideAction.grant, 4, TOURNAMENT, None),
            (IN_COHORT[0], AchievementOverrideAction.revoke, 1, None, None),  # global
            (OUT_OF_COHORT[0], AchievementOverrideAction.revoke, 1, None, None),
            (IN_COHORT[1], AchievementOverrideAction.revoke, 2, OTHER_TOURNAMENT, None),  # tournament
            (OUT_OF_COHORT[1], AchievementOverrideAction.revoke, 2, OTHER_TOURNAMENT, None),
            (IN_COHORT[1], AchievementOverrideAction.revoke, 3, TOURNAMENT, MATCH),  # match
            (OUT_OF_COHORT[1], AchievementOverrideAction.revoke, 3, TOURNAMENT, MATCH),
        ):
            self.session.execute(
                sa.insert(AchievementOverride.__table__).values(
                    id=override_id,
                    achievement_rule_id=rule_id,
                    workspace_member_id=player_id,
                    tournament_id=tournament_id,
                    match_id=match_id,
                    action=action,
                    reason="test",
                    granted_by=1,
                )
            )
            override_id += 1
        self.session.commit()

    def _rows(self, **kwargs: object) -> set[tuple[int, int, int | None, int | None]]:
        sub = build_effective_achievement_rows_subquery(**kwargs)  # type: ignore[arg-type]
        result = self.session.execute(
            sa.select(sub.c.user_id, sub.c.achievement_rule_id, sub.c.tournament_id, sub.c.match_id)
        )
        return {(int(u), int(r), t, m) for u, r, t, m in result}

    @staticmethod
    def _cohort_select() -> sa.Select:
        return sa.select(WorkspaceMember.player_id).where(WorkspaceMember.player_id.in_(IN_COHORT))

    def test_the_fixture_actually_exercises_revokes(self) -> None:
        """Guard the guard: if nothing is revoked, equivalence proves nothing."""
        unrestricted = self._rows(user_ids=None)
        self.assertNotIn((IN_COHORT[0], 1, TOURNAMENT, None), unrestricted, "global revoke did not apply")
        self.assertNotIn((IN_COHORT[1], 2, OTHER_TOURNAMENT, None), unrestricted, "tournament revoke did not apply")
        self.assertNotIn((IN_COHORT[1], 3, TOURNAMENT, MATCH), unrestricted, "match revoke did not apply")
        self.assertIn((IN_COHORT[0], 4, TOURNAMENT, None), unrestricted, "grant did not surface")

    def test_a_selectable_cohort_yields_the_unrestricted_rows_filtered(self) -> None:
        unrestricted = self._rows(user_ids=None)
        expected = {row for row in unrestricted if row[0] in IN_COHORT}
        self.assertEqual(expected, self._rows(user_ids=self._cohort_select()))

    def test_a_selectable_cohort_matches_the_equivalent_list(self) -> None:
        self.assertEqual(
            self._rows(user_ids=list(IN_COHORT)),
            self._rows(user_ids=self._cohort_select()),
            msg="a subquery cohort must select what the same ids as a list would",
        )

    def test_an_empty_list_still_means_everybody(self) -> None:
        """Pre-existing behaviour, relied on by callers that pass ``[]`` for 'no
        filter'. Only ``None`` and an empty list share that meaning — a selectable
        that matches nothing correctly yields nothing."""
        self.assertEqual(self._rows(user_ids=None), self._rows(user_ids=[]))
        self.assertEqual(
            set(),
            self._rows(user_ids=sa.select(WorkspaceMember.player_id).where(sa.false())),
        )

    def test_the_narrowing_reaches_both_union_branches(self) -> None:
        """Not just the evaluation side: a grant must be filtered too, or an
        out-of-cohort grant would leak through the union."""
        rows = self._rows(user_ids=self._cohort_select())
        self.assertIn((IN_COHORT[0], 4, TOURNAMENT, None), rows)
        self.assertEqual(set(), {row for row in rows if row[0] in OUT_OF_COHORT})
