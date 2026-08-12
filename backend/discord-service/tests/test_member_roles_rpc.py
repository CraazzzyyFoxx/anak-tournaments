import os
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

# Importing `main` instantiates the service `Settings`, which requires the whole
# Postgres/Redis/Rabbit block on top of the Discord credentials. Without these the
# file only passed on a machine with a populated backend/.env — in CI it raised
# five missing-field ValidationErrors before a single test ran. Nothing here
# connects; the values only have to parse.
#
# The AMQP URL deliberately carries no `user:pass@` (AmqpDsn accepts that) — the
# `guest:guest@` form other suites use is what GitGuardian reports as a leaked
# secret, and a placeholder is not worth a security finding on every PR.
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


def _registered_handlers():
    """Run the real registration and index the handlers by queue name.

    ``*extra`` matters: the match-log result subscriber is bound to an exchange
    as a second positional argument, and a one-arg fake silently made it look
    like that subscriber did not exist.
    """
    from main import register_rabbit_handlers

    handlers: dict[str, object] = {}

    def fake_subscriber(queue, *extra):
        def decorator(fn):
            handlers[getattr(queue, "name", str(queue))] = fn
            return fn

        return decorator

    fake_broker = MagicMock()
    fake_broker.subscriber = fake_subscriber
    register_rabbit_handlers(fake_broker)
    return handlers


def _role(
    role_id: int, *, default: bool = False, position: int = 1, managed: bool = False, name: str = "role", color: int = 0
):
    role = MagicMock(id=role_id, position=position, managed=managed)
    role.name = name
    role.color.value = color
    role.is_default.return_value = default
    return role


class HandlerRegistrationTests(IsolatedAsyncioTestCase):
    def test_match_log_result_subscriber_is_registered(self) -> None:
        """Regression: it was once nested in an unrelated module-level function.

        Nothing then consumed MATCH_LOG_RESULT_EXCHANGE, so every attachment
        upload waited out the full 120s result timeout instead of getting its
        parser verdict -- and the handler's own `broker` reference was undefined.
        """
        names = {getattr(h, "__name__", "") for h in _registered_handlers().values()}
        self.assertIn("handle_match_log_result", names)
        self.assertIn("handle_discord_command", names)


class MemberRolesRPCTests(IsolatedAsyncioTestCase):
    async def test_handle_get_member_roles_success(self) -> None:
        handler = _registered_handlers()["discord_member_roles"]

        everyone = _role(999, default=True)
        role1 = _role(100)
        role2 = _role(200)
        fake_member = MagicMock(id=111, roles=[everyone, role1, role2])
        fake_guild = MagicMock(id=999, roles=[everyone, role1, role2])
        fake_guild.get_member.side_effect = lambda uid: fake_member if uid == 111 else None
        fake_guild.fetch_member = AsyncMock(side_effect=lambda uid: fake_member if uid == 111 else None)

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            result = await handler({"guild_id": "999", "user_ids": ["111", "222"]}, MagicMock())

        # The guild role list keeps @everyone (the drift check compares against
        # it), but the member's own roles drop it to match what Discord's REST
        # member object returns on the HTTP fallback path.
        self.assertEqual(result["guild_role_ids"], ["999", "100", "200"])
        self.assertTrue(result["members"]["111"]["found"])
        self.assertEqual(result["members"]["111"]["roles"], ["100", "200"])
        self.assertFalse(result["members"]["222"]["found"])

    async def test_handle_get_member_roles_reports_unknown_guild(self) -> None:
        handler = _registered_handlers()["discord_member_roles"]

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = None
            mock_client.fetch_guild = AsyncMock(side_effect=_http_exception())

            result = await handler({"guild_id": "999", "user_ids": ["111"]}, MagicMock())

        self.assertEqual(result["error"], "guild_not_found")
        self.assertEqual(result["members"], {})

    async def test_handle_get_guild_roles_success(self) -> None:
        handler = _registered_handlers()["discord_guild_roles"]

        admin = _role(100, position=2, name="Admin", color=0xFF0000)
        member = _role(200, position=1, name="Member", color=0)
        fake_guild = MagicMock(id=999, roles=[member, admin])

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            result = await handler({"guild_id": "999"}, MagicMock())

        self.assertEqual(result["guild_id"], "999")
        self.assertEqual(result["roles"][0]["name"], "Admin")
        self.assertEqual(result["roles"][0]["color"], "#ff0000")
        self.assertIsNone(result["roles"][1]["color"])

    async def test_handle_get_guild_channels_success(self) -> None:
        handler = _registered_handlers()["discord_guild_channels"]

        fake_cat = MagicMock()
        fake_cat.name = "MATCHES"
        fake_ch1 = MagicMock(id=555, category=fake_cat, position=1)
        fake_ch1.name = "match-logs"
        fake_guild = MagicMock(id=999, text_channels=[fake_ch1])

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            result = await handler({"guild_id": "999"}, MagicMock())

        self.assertEqual(result["guild_id"], "999")
        self.assertEqual(len(result["channels"]), 1)
        self.assertEqual(result["channels"][0]["name"], "match-logs")
        self.assertEqual(result["channels"][0]["category_name"], "MATCHES")

    async def test_handle_get_guild_channels_fetches_for_uncached_guild(self) -> None:
        """A guild obtained via ``fetch_guild`` carries no channel cache.

        Reading ``text_channels`` off it would answer "no channels" for a server
        that has plenty, so the handler must fetch them over REST instead.
        """
        import discord

        fake_cat = MagicMock()
        fake_cat.name = "MATCHES"
        text_channel = MagicMock(spec=discord.TextChannel, id=555, category=fake_cat, position=1)
        text_channel.name = "match-logs"
        voice_channel = MagicMock(spec=discord.VoiceChannel, id=666, position=2)

        # Exactly the trap: the cache is empty on a fetched guild.
        fake_guild = MagicMock(id=999, text_channels=[])
        fake_guild.fetch_channels = AsyncMock(return_value=[voice_channel, text_channel])

        handler = _registered_handlers()["discord_guild_channels"]
        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = None
            mock_client.fetch_guild = AsyncMock(return_value=fake_guild)

            result = await handler({"guild_id": "999"}, MagicMock())

        fake_guild.fetch_channels.assert_awaited_once()
        self.assertEqual([c["name"] for c in result["channels"]], ["match-logs"])

    async def test_handle_get_guild_info_success(self) -> None:
        handler = _registered_handlers()["discord_guild_info"]

        fake_guild = MagicMock(id=999, member_count=42, icon=MagicMock(url="http://icon.png"))
        fake_guild.name = "Test Server"

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = fake_guild

            result = await handler({"guild_id": "999"}, MagicMock())

        self.assertEqual(result["guild_id"], "999")
        self.assertTrue(result["connected"])
        self.assertEqual(result["name"], "Test Server")
        self.assertEqual(result["member_count"], 42)

    async def test_handle_get_guild_info_uses_approximate_count_when_uncached(self) -> None:
        """``member_count`` is gateway-only; a fetched guild would report 0."""
        handler = _registered_handlers()["discord_guild_info"]

        fake_guild = MagicMock(id=999, member_count=None, approximate_member_count=7, icon=None)
        fake_guild.name = "Test Server"

        with patch("main.client") as mock_client:
            mock_client.wait_until_ready = AsyncMock()
            mock_client.get_guild.return_value = None
            mock_client.fetch_guild = AsyncMock(return_value=fake_guild)

            result = await handler({"guild_id": "999"}, MagicMock())

        self.assertTrue(result["connected"])
        self.assertEqual(result["member_count"], 7)
        self.assertIsNone(result["icon_url"])

    async def test_on_member_update_triggers_subscription_change(self) -> None:
        from main import on_member_update

        r1 = MagicMock(id=100)
        r2 = MagicMock(id=200)

        before = MagicMock(id=111, roles=[r1], guild=MagicMock(id=999))
        after = MagicMock(id=111, roles=[r1, r2], guild=MagicMock(id=999))

        with patch("main.handle_member_subscription_change", AsyncMock()) as mock_handle:
            await on_member_update(before, after)
            mock_handle.assert_awaited_once_with("999", "111", "role_update")


def _http_exception():
    import discord

    return discord.HTTPException(MagicMock(status=404), "not found")
