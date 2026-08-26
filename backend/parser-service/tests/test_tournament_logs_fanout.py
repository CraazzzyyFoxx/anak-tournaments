"""The bulk "process every log of this tournament" job must fan out, not parse.

Parsing the whole tournament inline held one session and one unacked delivery for
as long as it took to chew every file. That outruns RabbitMQ's ``consumer_timeout``
(30 minutes by default), which closes the channel and requeues the delivery — and
the requeued message is then dropped, because its 10-minute TTL expired long ago.
Every log the run had not reached yet stayed on "Queued". Publishing one
``ProcessMatchLogEvent`` per file puts the work on the normal single-log path,
which is deduped, retried and reaped.
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
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ["DEBUG"] = "true"

serve = importlib.import_module("serve")
messaging_config = importlib.import_module("shared.messaging.config")

KEYS = ["logs/42/Log-a.txt", "logs/42/Log-b.txt"]


class _Session:
    """Answers the tournament-exists probe and nothing else."""

    def __init__(self, tournament_id: int | None) -> None:
        self._tournament_id = tournament_id

    async def __aenter__(self) -> _Session:
        return self

    async def __aexit__(self, *_exc) -> None:
        return None

    async def scalar(self, _statement):
        return self._tournament_id


class TournamentLogsFanoutTests(IsolatedAsyncioTestCase):
    async def _run(self, *, tournament_id: int | None, keys: list[str]) -> AsyncMock:
        publish = AsyncMock()
        with (
            patch.object(serve.db, "async_session_maker", lambda: _Session(tournament_id)),
            patch.object(serve.binary_match_logs, "get_logs_by_tournament", AsyncMock(return_value=keys)),
            patch.object(serve, "publish_message", publish),
            patch.object(serve.logs_flows, "process_match_log", AsyncMock()) as parse,
        ):
            await serve.process_tournament_log(
                {"event_type": "process_tournament_logs", "tournament_id": 42},
                SimpleNamespace(headers={}, message_id=None, raw_message=None),
            )
        parse.assert_not_awaited()
        return publish

    async def test_every_log_gets_its_own_process_match_log_message(self) -> None:
        publish = await self._run(tournament_id=42, keys=KEYS)

        self.assertEqual(2, publish.await_count)
        queues = {call.args[2] for call in publish.await_args_list}
        self.assertEqual({messaging_config.PROCESS_MATCH_LOG_QUEUE}, queues)
        filenames = [call.args[1]["filename"] for call in publish.await_args_list]
        self.assertEqual(KEYS, filenames)
        self.assertEqual([42, 42], [call.args[1]["tournament_id"] for call in publish.await_args_list])

    async def test_unknown_tournament_publishes_nothing(self) -> None:
        with self.assertRaises(RuntimeError):
            await self._run(tournament_id=None, keys=KEYS)

    async def test_tournament_without_logs_publishes_nothing(self) -> None:
        publish = await self._run(tournament_id=42, keys=[])

        publish.assert_not_awaited()
