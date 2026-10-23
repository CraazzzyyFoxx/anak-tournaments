from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))

from shared.messaging.config import PICKUP_MIX_CHANGED_QUEUE  # noqa: E402
from shared.models.platform.outbox import EventOutbox  # noqa: E402
from shared.services import pickup_mix_realtime  # noqa: E402
from shared.services.realtime import Resource, Scope  # noqa: E402
from shared.services.realtime.emit import _STAGED_KEY  # noqa: E402


class _Session:
    """Records what the emitter stages: ``info`` is where ``emit`` hangs the transaction's realtime events (as
    SQLAlchemy's ``Session.info`` does), ``added`` the outbox rows, and ``commit`` exists only so calling it is
    visible."""

    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = 0
        self.info: dict[str, Any] = {}

    def add(self, row: object) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        pass

    async def commit(self) -> None:
        self.committed += 1

    def outbox(self) -> list[EventOutbox]:
        return [row for row in self.added if isinstance(row, EventOutbox)]


class PickupMixRealtimeTests(IsolatedAsyncioTestCase):
    """What the two rails are told, not how they deliver it.

    Realtime delivery (staging, union, publish-after-commit) is pinned once in
    ``backend/tests/test_realtime_emit.py`` and the outbox drain in
    ``backend/tests/test_outbox.py``; what matters here is the audience, the
    resource and the ids, because getting any of them wrong sends a workspace's
    roster to the wrong people or leaves a stale card in a Discord channel.
    """

    async def test_a_roster_edit_stales_the_workspace_pickup_mix(self) -> None:
        session = _Session()

        await pickup_mix_realtime.emit_pickup_mix_changed(
            session, 7, custom_game_id=11, change="roster", actor_user_id=9
        )

        staged = session.info[_STAGED_KEY]
        self.assertEqual({Scope.workspace(7): ({Resource.WORKSPACE_PICKUP_MIX}, {})}, staged.invalidations)
        ((scope, _data, actor),) = staged.domain
        self.assertEqual(Scope.workspace(7), scope)
        self.assertEqual(9, actor)

    async def test_the_data_event_is_non_durable_and_carries_no_row_data(self) -> None:
        session = _Session()

        await pickup_mix_realtime.emit_pickup_mix_changed(session, 7, custom_game_id=None, change="rank")

        ((_scope, data, _actor),) = session.info[_STAGED_KEY].domain
        self.assertEqual("pickup_mix", data.domain)
        self.assertEqual(pickup_mix_realtime.PICKUP_MIX_UPDATED, data.event_type)
        self.assertFalse(data.durable)
        self.assertEqual({"workspace_id": 7, "change": "rank"}, dict(data.payload))

    async def test_the_change_is_queued_as_a_durable_fact_for_the_projector(self) -> None:
        """A Discord channel has no client to refetch on reconnect, so the card
        is only as fresh as the event the projector got: it goes through the
        outbox, in the mutation's own transaction."""
        session = _Session()

        await pickup_mix_realtime.emit_pickup_mix_changed(session, 7, custom_game_id=11, change="roster")

        (row,) = session.outbox()
        self.assertEqual(("", PICKUP_MIX_CHANGED_QUEUE.name), (row.exchange, row.routing_key))
        self.assertEqual("pickup_mix.changed", row.event_type)
        payload = row.payload_json
        self.assertEqual((7, 11, "roster"), (payload["workspace_id"], payload["custom_game_id"], payload["change"]))
        self.assertEqual(0, session.committed)
