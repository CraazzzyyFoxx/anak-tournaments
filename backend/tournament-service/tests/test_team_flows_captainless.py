"""``team_flows.to_pydantic`` must survive a team with no captain.

``Team.captain_id`` is nullable in two real ways: it is ``ON DELETE SET NULL``
against the captain's player row, and a scrim room's away side is created with no
captain at all and stays that way until someone follows the share link
(docs/plans/2026-08-12-scrim-rooms.md §4.2). Requesting the ``captain`` entity
for such a team handed ``None`` straight to ``user_flows.to_pydantic`` and raised

    AttributeError: 'NoneType' object has no attribute 'id'

from inside the encounter read — so opening a scrim room's encounter 500'd.
``TeamRead.captain`` was already ``UserRead | None``; only the call was unguarded,
which is why the schema could not catch it.
"""

from __future__ import annotations

import importlib
import os
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DEBUG", "true")
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

team_flows = importlib.import_module("src.services.team.flows")


def _team(*, captain: object | None) -> SimpleNamespace:
    """A team shaped as a scrim room provisions one: named, rosterless, and with
    a captain on one side only."""
    return SimpleNamespace(
        id=701,
        name="Team B",
        image_url=None,
        avg_sr=0.0,
        total_sr=0,
        captain_id=getattr(captain, "id", None),
        captain=captain,
        tournament_id=99,
        players=[],
        standings=[],
    )


class ACaptainlessTeamSerializes(IsolatedAsyncioTestCase):
    async def test_the_captain_entity_on_an_unclaimed_side_yields_null(self) -> None:
        session = SimpleNamespace()
        # A SPY, not a stub: it delegates to the real serializer, so removing the
        # guard reproduces the production failure verbatim
        # (``AttributeError: 'NoneType' object has no attribute 'id'``) instead of
        # a mock leaking into the schema. ``assert_not_awaited`` then proves the
        # call is skipped rather than merely tolerated.
        spy = AsyncMock(side_effect=team_flows.user_flows.to_pydantic)
        with patch.object(team_flows.user_flows, "to_pydantic", spy):
            result = await team_flows.to_pydantic(session, _team(captain=None), ["captain"])

        self.assertIsNone(result.captain)
        self.assertIsNone(result.captain_id)
        spy.assert_not_awaited()

    async def test_a_claimed_side_still_serializes_its_captain(self) -> None:
        """The guard must not have turned the happy path off."""
        session = SimpleNamespace()
        captain = SimpleNamespace(id=1100, name="Captain", social_accounts=[])
        fake_read = team_flows.schemas.UserRead(id=1100, name="Captain")
        with patch.object(team_flows.user_flows, "to_pydantic", AsyncMock(return_value=fake_read)):
            result = await team_flows.to_pydantic(session, _team(captain=captain), ["captain"])

        self.assertEqual(fake_read, result.captain)
        self.assertEqual(1100, result.captain_id)

    async def test_without_the_entity_the_captain_is_not_resolved_either_way(self) -> None:
        session = SimpleNamespace()
        captain = SimpleNamespace(id=1100, name="Captain", social_accounts=[])
        user_to_pydantic = AsyncMock()
        with patch.object(team_flows.user_flows, "to_pydantic", user_to_pydantic):
            result = await team_flows.to_pydantic(session, _team(captain=captain), [])

        self.assertIsNone(result.captain)
        # Still reported, because it is a plain column and costs no load.
        self.assertEqual(1100, result.captain_id)
        user_to_pydantic.assert_not_awaited()
