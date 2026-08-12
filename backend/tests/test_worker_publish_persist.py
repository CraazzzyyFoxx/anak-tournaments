"""Durability contract for the shared worker publish helper.

Every caller of ``publish_message`` targets a durable work queue, but FastStream's
own ``persist`` default is ``False`` — a transient message on a durable queue,
which a broker restart discards without a trace. The dropped job leaves its row
behind with no live consumer (a match-log record stuck on ``pending``, i.e.
"Queued" forever in the admin console), so the default has to be flipped here.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

backend_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_root))

from shared.messaging.config import PROCESS_MATCH_LOG_QUEUE  # noqa: E402
from shared.observability import publish_message  # noqa: E402


class WorkerPublishPersistTests(IsolatedAsyncioTestCase):
    async def test_jobs_are_published_persistently_by_default(self) -> None:
        broker = AsyncMock()

        await publish_message(broker, {"tournament_id": 1}, PROCESS_MATCH_LOG_QUEUE)

        self.assertIs(True, broker.publish.await_args.kwargs["persist"])

    async def test_caller_can_opt_out_of_persistence(self) -> None:
        broker = AsyncMock()

        await publish_message(broker, {"tournament_id": 1}, PROCESS_MATCH_LOG_QUEUE, persist=False)

        self.assertIs(False, broker.publish.await_args.kwargs["persist"])
