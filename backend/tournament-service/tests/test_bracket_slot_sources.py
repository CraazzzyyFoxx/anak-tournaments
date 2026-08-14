"""``resolve_slot_sources`` hands a reader the bracket's real advancement edges.

Before this, a reader (the public bracket, an admin preview) inferred where an
unresolved slot's team would come from out of round numbers and match counts.
That inference cannot tell a lower bracket seeded straight from the group stage
-- whose round 1 holds seeds, so its slots really are TBD -- from a standard one
whose round 1 holds the upper bracket's first losers, and labelled the former
wrong. These lock in the shape the reader consumes: grouped by TARGET encounter,
with role/slot as the plain strings the wire carries.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "tournament-service"))

os.environ["DEBUG"] = "true"
os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

advancement = importlib.import_module("shared.services.bracket.advancement")
enums = importlib.import_module("shared.core.enums")

WINNER = enums.EncounterLinkRole.WINNER
LOSER = enums.EncounterLinkRole.LOSER
HOME = enums.EncounterLinkSlot.HOME
AWAY = enums.EncounterLinkSlot.AWAY


def _session(rows: list[tuple]) -> SimpleNamespace:
    return SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=lambda: rows)))


class ResolveSlotSourcesTests(IsolatedAsyncioTestCase):
    async def test_groups_edges_by_the_encounter_they_fill(self) -> None:
        # A split double elimination: LB R2 match 6 takes the winner of the
        # seeded LB R1 match 4 and the loser of UB R1 match 1.
        session = _session(
            [
                (6, 4, WINNER, HOME),
                (6, 1, LOSER, AWAY),
                (7, 5, WINNER, HOME),
            ]
        )

        sources = await advancement.resolve_slot_sources(session, [4, 5, 6, 7])

        self.assertEqual({6, 7}, set(sources))
        self.assertEqual(
            [(4, "winner", "home"), (1, "loser", "away")],
            [(source.encounter_id, source.role, source.slot) for source in sources[6]],
        )
        # A seeded round has no incoming edge at all — its slots stay TBD.
        self.assertNotIn(4, sources)
        self.assertNotIn(5, sources)

    async def test_asks_nothing_of_the_database_without_encounters(self) -> None:
        session = _session([])

        self.assertEqual({}, await advancement.resolve_slot_sources(session, []))
        self.assertEqual({}, await advancement.resolve_slot_sources(session, [None]))
        session.execute.assert_not_awaited()
