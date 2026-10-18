"""Leader/transport guards; real stalled-row transitions live in test_stats_ingest_db."""

import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))
os.environ["DEBUG"] = "true"

from tests._fakes import session_factory

reaper = importlib.import_module("src.services.match_logs.reaper")
config = importlib.import_module("shared.messaging.config")


class MatchLogReaperTests(IsolatedAsyncioTestCase):
    def test_pending_window_outlives_the_queue_ttl(self):
        self.assertGreater(
            reaper.settings.log_reaper_pending_after_seconds,
            config.PROCESS_MATCH_LOG_QUEUE.arguments["x-message-ttl"] / 1000,
        )

    async def test_second_replica_does_not_open_a_processing_session(self):
        factory = Mock()
        with (
            patch.object(reaper.settings, "log_reaper_enabled", True),
            patch.object(
                reaper, "acquire_distributed_lock", AsyncMock(side_effect=reaper.DistributedLockUnavailable("busy"))
            ),
        ):
            result = await reaper.reclaim_stalled_logs(redis=object(), session_factory=factory)
        self.assertEqual(0, result.touched)
        factory.assert_not_called()

    async def test_empty_claim_releases_leadership(self):
        release = AsyncMock()
        with (
            patch.object(reaper.settings, "log_reaper_enabled", True),
            patch.object(reaper, "acquire_distributed_lock", AsyncMock(return_value="owned")),
            patch.object(reaper, "release_distributed_lock", release),
            patch.object(reaper, "_claim_stalled", AsyncMock(return_value=([], []))),
        ):
            result = await reaper.reclaim_stalled_logs(
                redis=object(), session_factory=session_factory(SimpleNamespace())
            )
        self.assertEqual(0, result.touched)
        release.assert_awaited_once()
