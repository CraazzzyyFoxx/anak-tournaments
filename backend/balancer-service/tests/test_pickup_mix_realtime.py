from __future__ import annotations

import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

REPO_BACKEND_ROOT = Path(__file__).resolve().parents[2]
BALANCER_SERVICE_ROOT = REPO_BACKEND_ROOT / "balancer-service"
for candidate in (str(REPO_BACKEND_ROOT), str(BALANCER_SERVICE_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)


from src.services import pickup_mix_realtime  # noqa: E402


class PickupMixRealtimeTests(IsolatedAsyncioTestCase):
    async def test_publishes_a_non_durable_envelope_on_the_workspace_topic(self) -> None:
        with patch.object(pickup_mix_realtime, "publish_envelope_to_redis", new=AsyncMock()) as publish:
            await pickup_mix_realtime.emit_pickup_mix_updated(7, reason="roster", actor_user_id=9)

        publish.assert_awaited_once()
        kwargs = publish.await_args.kwargs
        self.assertEqual(kwargs["topic"], "workspace:7:pickup_mix")
        envelope = kwargs["envelope"]
        self.assertEqual(envelope.event_id, 0)
        self.assertEqual(envelope.event_type, pickup_mix_realtime.PICKUP_MIX_UPDATED)
        self.assertEqual(envelope.actor_user_id, 9)
        self.assertEqual(envelope.data, {"workspace_id": 7, "reason": "roster"})

    async def test_a_publish_failure_is_swallowed(self) -> None:
        with patch.object(
            pickup_mix_realtime, "publish_envelope_to_redis", new=AsyncMock(side_effect=RuntimeError("down"))
        ):
            await pickup_mix_realtime.emit_pickup_mix_updated(7, reason="rank")
        # No exception propagated -- a broadcast never fails the mutation it rides on.
