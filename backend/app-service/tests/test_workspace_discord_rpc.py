import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.rpc.workspaces import register


class WorkspaceDiscordRPCTests(IsolatedAsyncioTestCase):
    async def test_discord_roles_handler(self) -> None:
        fake_broker = MagicMock()
        registered = {}

        def fake_sub(topic):
            def dec(fn):
                registered[topic] = fn
                return fn
            return dec

        fake_broker.subscriber = fake_sub
        register(fake_broker, MagicMock())

        handler = registered.get("rpc.app.workspaces.discord_roles")
        self.assertIsNotNone(handler)

        fake_ws = MagicMock(id=1, discord_guild_id="999")
        fake_broker.request = AsyncMock(return_value={"guild_id": "999", "roles": [{"id": "100", "name": "Admin"}]})

        with patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=fake_ws)):
            msg = MagicMock()
            result = await handler({"workspace_id": 1}, msg)

        self.assertEqual(result["data"]["roles"][0]["name"], "Admin")

    async def test_discord_channels_handler(self) -> None:
        fake_broker = MagicMock()
        registered = {}

        def fake_sub(topic):
            def dec(fn):
                registered[topic] = fn
                return fn
            return dec

        fake_broker.subscriber = fake_sub
        register(fake_broker, MagicMock())

        handler = registered.get("rpc.app.workspaces.discord_channels")
        self.assertIsNotNone(handler)

        fake_ws = MagicMock(id=1, discord_guild_id="999")
        fake_broker.request = AsyncMock(return_value={"guild_id": "999", "channels": [{"id": "555", "name": "match-logs"}]})

        with patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=fake_ws)):
            msg = MagicMock()
            result = await handler({"workspace_id": 1}, msg)

        self.assertEqual(result["data"]["channels"][0]["name"], "match-logs")

    async def test_discord_guild_handler(self) -> None:
        fake_broker = MagicMock()
        registered = {}

        def fake_sub(topic):
            def dec(fn):
                registered[topic] = fn
                return fn
            return dec

        fake_broker.subscriber = fake_sub
        register(fake_broker, MagicMock())

        handler = registered.get("rpc.app.workspaces.discord_guild")
        self.assertIsNotNone(handler)

        fake_ws = MagicMock(id=1, discord_guild_id="999")
        fake_broker.request = AsyncMock(return_value={"guild_id": "999", "connected": True, "name": "Server"})

        with patch("src.rpc.workspaces.workspace_service.get_by_id", AsyncMock(return_value=fake_ws)):
            msg = MagicMock()
            result = await handler({"workspace_id": 1}, msg)

        self.assertTrue(result["data"]["connected"])
        self.assertEqual(result["data"]["name"], "Server")
