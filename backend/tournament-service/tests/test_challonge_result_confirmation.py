"""Challonge import is a confirmation, not a status poke.

Two defects are pinned here. The import used to write ``status`` without
``result_status``, so an imported result was invisible to the standings filter
that requires CONFIRMED, and it never emitted EncounterCompletedEvent — the same
result entered by an admin triggered achievement/MVP recalculation, an imported
one silently did not. Its conflict guard also consulted only ``was_completed``,
so a remote score would overwrite a live dispute and destroy the captains'
evidence.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "test")
os.environ.setdefault("CHALLONGE_API_KEY", "test")

sync = importlib.import_module("src.services.challonge.sync")
enums = importlib.import_module("shared.core.enums")


def _encounter(*, status, result_status, home=0, away=0) -> SimpleNamespace:
    return SimpleNamespace(
        id=10,
        tournament_id=1,
        stage_id=None,
        stage_item_id=None,
        home_team_id=1,
        away_team_id=2,
        home_score=home,
        away_score=away,
        round=1,
        name="a vs b",
        status=status,
        result_status=result_status,
        closeness=None,
        confirmed_at=None,
    )


class AdvanceCompletedMatches(IsolatedAsyncioTestCase):
    """``_advance_completed_challonge_matches`` re-fires advancement for every
    complete match on every import, so it must be idempotent in the audit too."""

    async def _run(self, encounter):
        added: list = []
        session = SimpleNamespace(add=added.append)
        lookup = SimpleNamespace(get=lambda _s, _m: encounter)
        matches = [(SimpleNamespace(), SimpleNamespace(id=1, state="complete"))]
        captured: dict = {}

        async def fake_finalize(*_a, **kw):
            captured.update(kw)
            if kw.get("result_status") is not None:
                encounter.result_status = kw["result_status"]
            encounter.status = enums.EncounterStatus.COMPLETED
            return SimpleNamespace(encounter=encounter, advanced_encounters=[])

        with patch.object(sync.finalize_service, "finalize_encounter_score", AsyncMock(side_effect=fake_finalize)):
            await sync.sync_service._advance_completed_challonge_matches(session, matches, match_lookup=lookup)
        return captured, added

    async def test_confirms_an_unconfirmed_complete_match(self) -> None:
        encounter = _encounter(
            status=enums.EncounterStatus.COMPLETED,
            result_status=enums.EncounterResultStatus.NONE,
            home=2,
        )
        captured, added = await self._run(encounter)

        self.assertEqual(enums.EncounterResultStatus.CONFIRMED, captured["result_status"])
        self.assertIsNotNone(captured["confirmed_at"])
        audit = [o for o in added if type(o).__name__ == "EncounterResultAudit"]
        self.assertEqual(1, len(audit))
        self.assertEqual(enums.EncounterResultAuditAction.IMPORT, audit[0].action)
        # An external system decided this — that NULL actor is what tells it
        # apart from an admin resolution in the trail.
        self.assertIsNone(audit[0].actor_user_id)

    async def test_leaves_an_already_confirmed_match_alone(self) -> None:
        encounter = _encounter(
            status=enums.EncounterStatus.COMPLETED,
            result_status=enums.EncounterResultStatus.CONFIRMED,
            home=2,
        )
        captured, added = await self._run(encounter)

        # Advancement still re-fires (idempotent), but nothing is re-stamped…
        self.assertIsNone(captured["result_status"])
        self.assertIsNone(captured["confirmed_at"])
        # …and the audit does not grow on every import run.
        self.assertEqual([], [o for o in added if type(o).__name__ == "EncounterResultAudit"])


class ConflictGuardProtectsLocalDecisions(IsolatedAsyncioTestCase):
    """The guard keys on result_status, not just status."""

    def test_a_decision_in_progress_outranks_the_remote_result(self) -> None:
        for result_status in (
            enums.EncounterResultStatus.CONFIRMED,
            enums.EncounterResultStatus.DISPUTED,
            enums.EncounterResultStatus.PENDING_CONFIRMATION,
        ):
            with self.subTest(result_status=result_status):
                encounter = _encounter(status=enums.EncounterStatus.OPEN, result_status=result_status)
                self.assertTrue(sync._has_local_decision(encounter))

    def test_an_untouched_encounter_is_not_protected(self) -> None:
        """Otherwise the importer could never fill in a fresh bracket."""
        encounter = _encounter(status=enums.EncounterStatus.OPEN, result_status=enums.EncounterResultStatus.NONE)
        self.assertFalse(sync._has_local_decision(encounter))

    def test_completed_without_a_result_status_is_still_protected(self) -> None:
        """Legacy rows completed before the state machine existed."""
        encounter = _encounter(status=enums.EncounterStatus.COMPLETED, result_status=enums.EncounterResultStatus.NONE)
        self.assertTrue(sync._has_local_decision(encounter))
