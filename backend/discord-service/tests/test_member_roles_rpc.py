import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("DISCORD_TOKEN", "dummy_token")
os.environ.setdefault("PARSER_URL", "http://parser:8002")
os.environ.setdefault("SERVICE_CLIENT_ID", "dummy_id")
os.environ.setdefault("SERVICE_CLIENT_SECRET", "dummy_secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class MemberRolesRPCTests(IsolatedAsyncioTestCase):
    async def test_handle_get_member_roles_success(self) -> None:
        from main import register_rabbit_handlers

        fake_broker = MagicMock()
        registered_subscribers = {}

        def fake_subscriber(queue):
            def decorator(fn):
                registered_subscribers[getattr(queue, "name", str(queue))] = fn
                return fn
            return decorator

        fake_broker.subscriber = fake_subscriber
        register_rabbit_handlers(fake_broker)

        handler = registered_subscribers.get("discord_member_roles")
        self.assertIsNotNone(handler)
        fake_role1 = MagicMock(id=100)
        fake_role2 = MagicMock(id=200)
        fake_member = MagicMock(id=111, roles=[fake_role1, fake_role2])
        fake_guild = MagicMock(id=999, roles=[fake_role1, fake_role2])
        fake_guild.get_member.side_effect = lambda uid: fake_member if uid == 111 else None
        fake_guild.fetch_member = AsyncMock(side_effect=lambda uid: fake_member if uid == 111 else None)
        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            msg = MagicMock()
            result = await handler({"guild_id": "999", "user_ids": ["111", "222"]}, msg)

        self.assertEqual(result["guild_role_ids"], ["100", "200"])
        self.assertTrue(result["members"]["111"]["found"])
        self.assertEqual(result["members"]["111"]["roles"], ["100", "200"])
        self.assertFalse(result["members"]["222"]["found"])

    async def test_handle_get_guild_roles_success(self) -> None:
        from main import register_rabbit_handlers

        fake_broker = MagicMock()
        registered_subscribers = {}

        def fake_subscriber(queue):
            def decorator(fn):
                registered_subscribers[getattr(queue, "name", str(queue))] = fn
                return fn
            return decorator

        fake_broker.subscriber = fake_subscriber
        register_rabbit_handlers(fake_broker)

        handler = registered_subscribers.get("discord_guild_roles")
        self.assertIsNotNone(handler)

        fake_role1 = MagicMock(id=100, position=2, managed=False)
        fake_role1.name = "Admin"
        fake_role1.color.value = 0xFF0000

        fake_role2 = MagicMock(id=200, position=1, managed=False)
        fake_role2.name = "Member"
        fake_role2.color.value = 0

        fake_guild = MagicMock(id=999, roles=[fake_role1, fake_role2])

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            msg = MagicMock()
            result = await handler({"guild_id": "999"}, msg)

        self.assertEqual(result["guild_id"], "999")
        self.assertEqual(len(result["roles"]), 2)
        self.assertEqual(result["roles"][0]["name"], "Admin")
        self.assertEqual(result["roles"][0]["color"], "#ff0000")

    async def test_handle_get_guild_channels_success(self) -> None:
        from main import register_rabbit_handlers

        fake_broker = MagicMock()
        registered_subscribers = {}

        def fake_subscriber(queue):
            def decorator(fn):
                registered_subscribers[getattr(queue, "name", str(queue))] = fn
                return fn
            return decorator

        fake_broker.subscriber = fake_subscriber
        register_rabbit_handlers(fake_broker)

        handler = registered_subscribers.get("discord_guild_channels")
        self.assertIsNotNone(handler)

        fake_cat = MagicMock()
        fake_cat.name = "MATCHES"
        fake_ch1 = MagicMock(id=555, category=fake_cat, position=1)
        fake_ch1.name = "match-logs"
        fake_guild = MagicMock(id=999, text_channels=[fake_ch1])

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            msg = MagicMock()
            result = await handler({"guild_id": "999"}, msg)

        self.assertEqual(result["guild_id"], "999")
        self.assertEqual(len(result["channels"]), 1)
        self.assertEqual(result["channels"][0]["name"], "match-logs")
        self.assertEqual(result["channels"][0]["category_name"], "MATCHES")

    async def test_handle_get_guild_info_success(self) -> None:
        from main import register_rabbit_handlers

        fake_broker = MagicMock()
        registered_subscribers = {}

        def fake_subscriber(queue):
            def decorator(fn):
                registered_subscribers[getattr(queue, "name", str(queue))] = fn
                return fn
            return decorator

        fake_broker.subscriber = fake_subscriber
        register_rabbit_handlers(fake_broker)

        handler = registered_subscribers.get("discord_guild_info")
        self.assertIsNotNone(handler)

        fake_guild = MagicMock(id=999, member_count=42, icon=MagicMock(url="http://icon.png"))
        fake_guild.name = "Test Server"

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            msg = MagicMock()
            result = await handler({"guild_id": "999"}, msg)

        self.assertEqual(result["guild_id"], "999")
        self.assertTrue(result["connected"])
        self.assertEqual(result["name"], "Test Server")
        self.assertEqual(result["member_count"], 42)
    async def test_on_member_update_triggers_subscription_change(self) -> None:
        from main import on_member_update

        r1 = MagicMock(id=100)
        r2 = MagicMock(id=200)

        before = MagicMock(id=111, roles=[r1], guild=MagicMock(id=999))
        after = MagicMock(id=111, roles=[r1, r2], guild=MagicMock(id=999))

        with patch("main.handle_member_subscription_change", AsyncMock()) as mock_handle:
            await on_member_update(before, after)
            mock_handle.assert_awaited_once_with("999", "111", "role_update")
