from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "parser-service"))

os.environ.setdefault("PROJECT_URL", "http://localhost")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("CHALLONGE_USERNAME", "x")
os.environ.setdefault("CHALLONGE_API_KEY", "x")
os.environ.setdefault("S3_ACCESS_KEY", "x")
os.environ.setdefault("S3_SECRET_KEY", "x")
os.environ.setdefault("S3_ENDPOINT_URL", "http://x")
from shared.schemas.settings import SubscriptionCollectionConfig


class SubscriptionCollectionServiceTests(IsolatedAsyncioTestCase):
    async def test_find_tournaments_requiring_subscriptions(self):
        from src.services.subscription_collection import service

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = [(10, 1), (20, 2)]
        mock_session.execute = AsyncMock(return_value=mock_result)

        res = await service.find_tournaments_requiring_subscriptions(mock_session)
        self.assertEqual(res, [(10, 1), (20, 2)])

    async def test_load_auth_user_ids_for_tournament(self):
        from src.services.subscription_collection import service

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = [(100,), (200,)]
        mock_session.execute = AsyncMock(return_value=mock_result)

        res = await service.load_auth_user_ids_for_tournament(mock_session, 10)
        self.assertEqual(res, [100, 200])

    async def test_collect_subscriptions_for_active_tournaments_empty(self):
        from src.services.subscription_collection import service

        mock_session = AsyncMock()
        with patch.object(service, "find_tournaments_requiring_subscriptions", AsyncMock(return_value=[])):
            res = await service.collect_subscriptions_for_active_tournaments(mock_session)
            self.assertEqual(res, 0)

    async def test_collect_subscriptions_for_active_tournaments_processes(self):
        from src.services.subscription_collection import service

        mock_session = AsyncMock()
        mock_resolver = AsyncMock()
        mock_resolver.resolve.return_value = {100: {}, 200: {}}

        with patch.object(service, "find_tournaments_requiring_subscriptions", AsyncMock(return_value=[(10, 1)])), \
             patch.object(service, "load_auth_user_ids_for_tournament", AsyncMock(return_value=[100, 200])), \
             patch.object(service, "build_resolver", return_value=mock_resolver):
            res = await service.collect_subscriptions_for_active_tournaments(mock_session)
            self.assertEqual(res, 2)
            mock_resolver.resolve.assert_called_once_with(
                workspace_id=1,
                auth_user_ids=[100, 200],
                providers=["boosty", "twitch"],
                force_refresh=True,
            )


class SubscriptionCollectionSchedulerTests(IsolatedAsyncioTestCase):
    async def test_run_subscription_collection_tick(self):
        from shared.services.distributed_lock import DistributedLockToken
        from src.services.subscription_collection import scheduler

        mock_session = AsyncMock()
        mock_cm = AsyncMock()
        mock_cm.__aenter__.return_value = mock_session
        mock_session_factory = MagicMock(return_value=mock_cm)
        mock_redis = AsyncMock()
        token = DistributedLockToken(key=scheduler.LEADER_LOCK_KEY, value="token-123")
        mock_release = AsyncMock()

        with patch("src.services.subscription_collection.scheduler.acquire_distributed_lock", AsyncMock(return_value=token)), \
             patch("src.services.subscription_collection.scheduler.release_distributed_lock", mock_release), \
             patch("shared.services.settings_provider.get_subscription_collection_config", AsyncMock(return_value=SubscriptionCollectionConfig(enabled=True))), \
             patch.object(scheduler.service, "collect_subscriptions_for_active_tournaments", AsyncMock(return_value=5)):

            count = await scheduler.run_subscription_collection_tick(mock_session_factory, mock_redis)
            self.assertEqual(count, 5)
            mock_release.assert_called_once_with(mock_redis, token)

    async def test_run_subscription_collection_tick_lock_unavailable(self):
        from shared.services.distributed_lock import DistributedLockUnavailable
        from src.services.subscription_collection import scheduler

        mock_redis = AsyncMock()
        mock_release = AsyncMock()

        with patch("src.services.subscription_collection.scheduler.acquire_distributed_lock", AsyncMock(side_effect=DistributedLockUnavailable("locked"))), \
             patch("src.services.subscription_collection.scheduler.release_distributed_lock", mock_release):

            count = await scheduler.run_subscription_collection_tick(AsyncMock(), mock_redis)
            self.assertEqual(count, 0)
            mock_release.assert_not_called()
