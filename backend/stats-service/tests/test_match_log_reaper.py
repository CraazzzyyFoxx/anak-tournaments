"""Leader/transport guards; real stalled-row transitions live in test_stats_ingest_db."""

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stats-service"))


from tests._fakes import session_factory

reaper = importlib.import_module("src.services.match_logs.reaper")
config = importlib.import_module("shared.messaging.config")


class MatchLogReaperTests(IsolatedAsyncioTestCase):
    def test_pending_window_outlives_the_queue_ttl(self):
        self.assertGreater(
            reaper.settings.log_reaper_pending_after_seconds,
            config.ingest_queue("overwatch").arguments["x-message-ttl"] / 1000,
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

    async def test_each_discipline_set_has_its_own_leader_and_a_busy_one_never_blocks_another(self):
        acquire = AsyncMock(return_value="owned")
        with (
            patch.object(reaper.settings, "log_reaper_enabled", True),
            patch.object(reaper, "acquire_distributed_lock", acquire),
            patch.object(reaper, "release_distributed_lock", AsyncMock()),
            patch.object(reaper, "_claim_stalled", AsyncMock(return_value=([], []))),
        ):
            for disciplines in (["overwatch"], ["lol"], ["lol", "overwatch"], ["overwatch", "lol"]):
                await reaper.reclaim_stalled_logs(
                    redis=object(), session_factory=session_factory(SimpleNamespace()), disciplines=disciplines
                )
        keys = [call.args[1] for call in acquire.await_args_list]
        self.assertEqual(3, len(set(keys)))
        self.assertEqual(keys[2], keys[3], "the key depends on the set, not on its order")

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
