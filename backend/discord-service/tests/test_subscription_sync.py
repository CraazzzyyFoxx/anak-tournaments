"""Regression coverage for `MemberSubscriptionSyncService`'s Redis wiring.

`Settings` used to omit `redis_url` entirely, so `settings.redis_url` raised
`AttributeError` inside `_build_redis_client` -- silently swallowed by its
broad `except Exception`, permanently disabling realtime subscription-cache
invalidation on Discord member/role events even though `REDIS_URL` was set in
the environment the whole time. See `src/core/config.py`.
"""

import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("DISCORD_TOKEN", "dummy_token")
os.environ.setdefault("PARSER_URL", "http://parser:8002")
os.environ.setdefault("SERVICE_CLIENT_ID", "dummy_id")
os.environ.setdefault("SERVICE_CLIENT_SECRET", "dummy_secret")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "not-a-real-password")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("RABBITMQ_URL", "amqp://localhost:5672")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.core.config import settings as real_settings  # noqa: E402
from src.services.subscription_sync import MemberSubscriptionSyncService  # noqa: E402


class SubscriptionSyncServiceTests(IsolatedAsyncioTestCase):
    async def test_build_redis_client_uses_settings_redis_url(self) -> None:
        service = MemberSubscriptionSyncService(settings=real_settings, session_maker=MagicMock())

        client = service._build_redis_client()
        try:
            self.assertIsNotNone(client)
        finally:
            if client is not None:
                await client.aclose()

    async def test_resync_skips_redis_when_no_workspace_matches(self) -> None:
        """No workspace for the guild -> returns before touching Redis or the resolver."""
        workspaces = MagicMock()
        workspaces.list_ids_by_discord_guild = AsyncMock(return_value=[])
        session = MagicMock()
        session_maker = MagicMock()
        session_maker.return_value.__aenter__ = AsyncMock(return_value=session)
        session_maker.return_value.__aexit__ = AsyncMock(return_value=False)

        service = MemberSubscriptionSyncService(
            settings=real_settings, session_maker=session_maker, workspaces=workspaces
        )

        await service.resync("999", "111", "member_join")

        session.commit.assert_not_called()
