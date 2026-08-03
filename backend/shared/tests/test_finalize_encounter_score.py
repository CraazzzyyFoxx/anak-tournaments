"""Unit tests for the shared encounter finalization primitive.

This is the single implementation both tournament-service and parser-service
call, so the elimination draw guard and the ``post_advance`` hook are covered
here rather than duplicated per service. Runs under stdlib unittest with a fake
session — no database, matching the repo's IsolatedAsyncioTestCase convention.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy.dialects import postgresql

from shared.core import enums
from shared.core.errors import BaseAPIException
from shared.services.encounter import finalize


class _Result:
    def __init__(self, row: object) -> None:
        self.row = row

    def scalar_one_or_none(self) -> object:
        return self.row


class _Session:
    """Minimal AsyncSession stand-in.

    ``execute`` returns the seeded encounter row (the ``FOR UPDATE`` load) and
    ``scalar`` returns the seeded stage type (the draw-guard probe).
    """

    def __init__(self, row: object, stage_type: enums.StageType | None = None) -> None:
        self.row = row
        self.stage_type = stage_type
        self.statement: Any = None
        self.commits = 0

    async def execute(self, statement: Any) -> _Result:
        self.statement = statement
        return _Result(self.row)

    async def scalar(self, statement: Any) -> Any:
        return self.stage_type

    async def commit(self) -> None:
        self.commits += 1


def _encounter(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": 10,
        "home_score": 0,
        "away_score": 0,
        "stage_id": None,
        "status": enums.EncounterStatus.OPEN,
        "result_status": enums.EncounterResultStatus.NONE,
        "confirmed_by_id": None,
        "confirmed_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _compiled_sql(statement: Any) -> str:
    return str(statement.compile(dialect=postgresql.dialect()))


class FinalizeEncounterScoreTests(IsolatedAsyncioTestCase):
    async def test_loads_row_for_update_when_encounter_not_supplied(self) -> None:
        encounter = _encounter()
        session = _Session(encounter)
        advance_winner = AsyncMock(return_value=[SimpleNamespace(id=20)])

        with patch.object(finalize.advancement, "advance_winner", advance_winner):
            result = await finalize.finalize_encounter_score(
                session,
                10,
                home_score=2,
                away_score=1,
                source="admin",
                result_status=enums.EncounterResultStatus.CONFIRMED,
                confirmed_by_id=200,
            )

        self.assertIs(result.encounter, encounter)
        self.assertEqual(2, encounter.home_score)
        self.assertEqual(1, encounter.away_score)
        self.assertEqual(enums.EncounterStatus.COMPLETED, encounter.status)
        self.assertEqual(enums.EncounterResultStatus.CONFIRMED, encounter.result_status)
        self.assertEqual(200, encounter.confirmed_by_id)
        self.assertIsNotNone(encounter.confirmed_at)
        self.assertEqual(1, advance_winner.await_count)
        self.assertIn("FOR UPDATE", _compiled_sql(session.statement))

    async def test_uses_supplied_locked_encounter_without_second_query(self) -> None:
        encounter = _encounter()
        session = Mock()
        session.execute = AsyncMock()

        with patch.object(finalize.advancement, "advance_winner", AsyncMock(return_value=[])):
            await finalize.finalize_encounter_score(
                session,
                10,
                encounter=encounter,
                home_score=3,
                away_score=0,
                source="captain",
            )

        session.execute.assert_not_awaited()
        self.assertEqual(3, encounter.home_score)
        self.assertEqual(0, encounter.away_score)
        self.assertEqual(enums.EncounterStatus.COMPLETED, encounter.status)

    async def test_records_the_source_on_the_result(self) -> None:
        """``source`` used to be discarded (``del source``); it now travels out
        so callers can attribute the transition without re-deriving it."""
        encounter = _encounter()
        session = _Session(encounter)

        with patch.object(finalize.advancement, "advance_winner", AsyncMock(return_value=[])):
            result = await finalize.finalize_encounter_score(
                session, 10, encounter=encounter, home_score=1, away_score=0, source="challonge"
            )

        self.assertEqual("challonge", result.source)

    async def test_rejects_drawn_score_on_an_elimination_stage(self) -> None:
        encounter = _encounter(stage_id=5)
        session = _Session(encounter, stage_type=enums.StageType.SINGLE_ELIMINATION)
        advance_winner = AsyncMock(return_value=[])

        with patch.object(finalize.advancement, "advance_winner", advance_winner):
            with self.assertRaises(BaseAPIException) as ctx:
                await finalize.finalize_encounter_score(
                    session, 10, encounter=encounter, home_score=1, away_score=1, source="admin"
                )

        self.assertEqual(400, ctx.exception.status_code)
        self.assertEqual(enums.EncounterStatus.OPEN, encounter.status)
        advance_winner.assert_not_awaited()

    async def test_allows_a_drawn_score_outside_elimination_stages(self) -> None:
        encounter = _encounter(stage_id=5)
        session = _Session(encounter, stage_type=enums.StageType.ROUND_ROBIN)

        with patch.object(finalize.advancement, "advance_winner", AsyncMock(return_value=[])):
            await finalize.finalize_encounter_score(
                session, 10, encounter=encounter, home_score=1, away_score=1, source="admin"
            )

        self.assertEqual(enums.EncounterStatus.COMPLETED, encounter.status)

    async def test_runs_post_advance_once_per_advanced_encounter(self) -> None:
        encounter = _encounter()
        session = _Session(encounter)
        advanced = [SimpleNamespace(id=20), SimpleNamespace(id=21)]
        post_advance = AsyncMock()

        with patch.object(finalize.advancement, "advance_winner", AsyncMock(return_value=advanced)):
            await finalize.finalize_encounter_score(
                session,
                10,
                encounter=encounter,
                home_score=2,
                away_score=0,
                source="admin",
                post_advance=post_advance,
            )

        self.assertEqual(2, post_advance.await_count)
        self.assertEqual(
            [advanced[0], advanced[1]],
            [call.args[1] for call in post_advance.await_args_list],
        )

    async def test_omitting_post_advance_is_a_no_op(self) -> None:
        """parser-service has no veto responsibility on some paths; the hook is
        optional and its absence must not raise."""
        encounter = _encounter()
        session = _Session(encounter)

        with patch.object(
            finalize.advancement, "advance_winner", AsyncMock(return_value=[SimpleNamespace(id=20)])
        ):
            result = await finalize.finalize_encounter_score(
                session, 10, encounter=encounter, home_score=2, away_score=0, source="log"
            )

        self.assertEqual(1, len(result.advanced_encounters))

    async def test_does_not_commit(self) -> None:
        """The caller owns the transaction boundary — finalize must stay inside it."""
        encounter = _encounter()
        session = _Session(encounter)

        with patch.object(finalize.advancement, "advance_winner", AsyncMock(return_value=[])):
            await finalize.finalize_encounter_score(
                session, 10, encounter=encounter, home_score=2, away_score=0, source="admin"
            )

        self.assertEqual(0, session.commits)

    async def test_rejects_an_encounter_id_mismatch(self) -> None:
        encounter = _encounter(id=11)
        session = _Session(encounter)

        with patch.object(finalize.advancement, "advance_winner", AsyncMock(return_value=[])):
            with self.assertRaises(ValueError):
                await finalize.finalize_encounter_score(
                    session, 10, encounter=encounter, home_score=1, away_score=0, source="admin"
                )
