"""``rpc.discord.*``: the permission gate, the bodies the settings pickers read, and the channel binding.

The database is faked at the repository seam and Discord at the bot; what is
asserted is the envelope the gateway would turn into an HTTP answer.
"""

import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import discord  # noqa: E402

from shared import models  # noqa: E402
from src import rpc_api  # noqa: E402
from src.services.directory import DirectoryOutcome  # noqa: E402
from tests.gateway_fakes import session_maker  # noqa: E402

WORKSPACE = 7
TOURNAMENT = 3
GUILD = "111111111111111111"
CHANNEL = "222222222222222222"

_OWNER = {
    "user_id": 100,
    "username": "alice",
    "is_active": True,
    "workspaces": [{"workspace_id": WORKSPACE, "rbac_roles": ["owner"], "rbac_permissions": []}],
}
_OUTSIDER = {"user_id": 3, "username": "mallory", "is_active": True, "workspaces": []}


def _text_channel(guild_id: str = GUILD) -> MagicMock:
    channel = MagicMock(spec=discord.TextChannel)
    channel.guild = MagicMock(id=int(guild_id))
    return channel


def _row(**overrides: Any) -> models.TournamentDiscordChannel:
    fields = {"id": 1, "tournament_id": TOURNAMENT, "channel_id": int(CHANNEL), "is_active": True}
    return models.TournamentDiscordChannel(**{**fields, **overrides})


def _created(_session: Any, row: models.TournamentDiscordChannel) -> models.TournamentDiscordChannel:
    row.id = 1
    return row


def _updated(_session: Any, row: models.TournamentDiscordChannel, fields: dict) -> models.TournamentDiscordChannel:
    for key, value in fields.items():
        setattr(row, key, value)
    return row


class _Api:
    """The real registration over a fake broker, a fake bot and faked repositories."""

    def __init__(self, *, guild_id: str | None = GUILD, row: models.TournamentDiscordChannel | None = None) -> None:
        self.directory = MagicMock()
        self.registry = MagicMock(reload=AsyncMock())
        self.bot = MagicMock(wait_until_ready=AsyncMock(), get_channel=MagicMock(return_value=_text_channel()))
        self.bot.attachment_processor.process_channel_history = AsyncMock()
        self.maker = session_maker()
        self.maker.session.refresh = AsyncMock()
        self.linked = SimpleNamespace(id=WORKSPACE, discord_guild_id=guild_id)
        self.channels = MagicMock(
            get_by_tournament=AsyncMock(return_value=row),
            create=AsyncMock(side_effect=_created),
            update_fields=AsyncMock(side_effect=_updated),
            delete=AsyncMock(),
        )
        self.handlers: dict[str, Any] = {}

        def subscriber(subject: str):
            def decorator(fn):
                self.handlers[subject] = fn
                return fn

            return decorator

        rpc_api.register(
            SimpleNamespace(subscriber=subscriber),
            bot=self.bot,
            registry=self.registry,
            directory=self.directory,
            session_maker=self.maker,
            logger=MagicMock(),
        )

    async def call(self, subject: str, data: dict[str, Any]) -> dict[str, Any]:
        with (
            patch.object(rpc_api, "_channels", self.channels),
            patch.object(rpc_api, "_workspaces", MagicMock(get=AsyncMock(return_value=self.linked))),
            patch.object(rpc_api, "get_tournament_workspace_id", AsyncMock(return_value=WORKSPACE)),
        ):
            return await self.handlers[subject](data, MagicMock())

    async def workspace(self, subject: str, identity: dict = _OWNER) -> dict[str, Any]:
        return await self.call(subject, {"workspace_id": WORKSPACE, "identity": identity})

    async def channel(self, action: str, payload: dict | None = None, identity: dict = _OWNER) -> dict[str, Any]:
        return await self.call(
            f"rpc.discord.channel.{action}", {"id": TOURNAMENT, "identity": identity, "payload": payload or {}}
        )


class PermissionGateTests(IsolatedAsyncioTestCase):
    async def test_an_outsider_reaches_neither_discord_nor_the_binding(self) -> None:
        api = _Api()
        api.directory.get_guild_roles = AsyncMock()

        for answer in (
            await api.workspace("rpc.discord.workspace_roles", _OUTSIDER),
            await api.channel("upsert", {"channel_id": CHANNEL}, _OUTSIDER),
            await api.channel("delete", identity=_OUTSIDER),
        ):
            self.assertEqual(answer["error"]["code"], "forbidden")
        api.directory.get_guild_roles.assert_not_awaited()
        api.channels.create.assert_not_awaited()
        api.channels.delete.assert_not_awaited()
        api.registry.reload.assert_not_awaited()

    async def test_every_handler_waits_for_the_gateway(self) -> None:
        api = _Api(guild_id=None)
        await api.workspace("rpc.discord.workspace_channels")
        api.bot.wait_until_ready.assert_awaited()


class WorkspaceGuildTests(IsolatedAsyncioTestCase):
    async def test_a_workspace_without_a_guild_reads_empty_and_asks_discord_nothing(self) -> None:
        api = _Api(guild_id=None)

        roles = await api.workspace("rpc.discord.workspace_roles")
        channels = await api.workspace("rpc.discord.workspace_channels")
        guild = await api.workspace("rpc.discord.workspace_guild")

        self.assertEqual(roles["data"], {"guild_id": None, "roles": []})
        self.assertEqual(channels["data"], {"guild_id": None, "channels": []})
        self.assertEqual(
            guild["data"],
            {
                "guild_id": None,
                "connected": False,
                "name": None,
                "icon_url": None,
                "member_count": 0,
                "owner_id": None,
                "owner_name": None,
                "owner_avatar_url": None,
            },
        )
        self.assertEqual(api.directory.mock_calls, [])

    async def test_an_unreachable_guild_degrades_instead_of_failing(self) -> None:
        api = _Api()
        api.directory.get_guild_roles = AsyncMock(
            return_value=DirectoryOutcome("error", {"error": "discord_error", "guild_id": GUILD, "roles": []})
        )
        api.directory.get_guild_info = AsyncMock(
            return_value=DirectoryOutcome(
                "guild_not_found", {"error": "guild_not_found", "guild_id": GUILD, "connected": False}
            )
        )

        roles = await api.workspace("rpc.discord.workspace_roles")
        guild = await api.workspace("rpc.discord.workspace_guild")

        self.assertTrue(roles["ok"])
        self.assertEqual(roles["data"], {"error": "discord_error", "guild_id": GUILD, "roles": []})
        self.assertEqual(guild["data"], {"error": "guild_not_found", "guild_id": GUILD, "connected": False})
        api.directory.get_guild_roles.assert_awaited_once_with(GUILD)

    async def test_a_linked_guild_answers_with_the_directorys_body(self) -> None:
        api = _Api()
        body = {"guild_id": GUILD, "channels": [{"id": CHANNEL, "type": "text"}]}
        api.directory.get_guild_channels = AsyncMock(return_value=DirectoryOutcome("success", body))

        self.assertEqual((await api.workspace("rpc.discord.workspace_channels"))["data"], body)


class ChannelUpsertTests(IsolatedAsyncioTestCase):
    async def test_a_workspace_without_a_guild_cannot_bind_a_channel(self) -> None:
        api = _Api(guild_id=None)

        answer = await api.channel("upsert", {"channel_id": CHANNEL})

        self.assertEqual(answer["error"]["code"], "conflict")
        self.assertEqual(answer["error"]["message"], "discord_guild_not_linked")
        api.channels.create.assert_not_awaited()

    async def test_a_channel_of_another_guild_or_kind_is_refused(self) -> None:
        voice = MagicMock(spec=discord.VoiceChannel)
        voice.guild = MagicMock(id=int(GUILD))
        for channel in (_text_channel("333333333333333333"), voice, None):
            with self.subTest(channel=channel):
                api = _Api()
                api.bot.get_channel.return_value = channel
                api.bot.fetch_channel = AsyncMock(side_effect=discord.NotFound(MagicMock(status=404), "gone"))

                answer = await api.channel("upsert", {"channel_id": CHANNEL})

                self.assertEqual(answer["error"]["code"], "unprocessable")
                self.assertEqual(answer["error"]["message"], "discord_channel_not_in_guild")
                api.channels.create.assert_not_awaited()
                api.registry.reload.assert_not_awaited()

        api = _Api()
        answer = await api.channel("upsert", {"channel_id": "not-a-snowflake"})
        self.assertEqual(answer["error"]["message"], "discord_channel_not_in_guild")

    async def test_a_channel_of_the_guild_is_bound_and_watched_at_once(self) -> None:
        api = _Api()

        answer = await api.channel("upsert", {"channel_id": CHANNEL, "channel_name": "logs"})

        self.assertTrue(answer["ok"], answer)
        self.assertEqual(
            answer["data"],
            {"id": 1, "tournament_id": TOURNAMENT, "channel_id": CHANNEL, "channel_name": "logs", "is_active": True},
        )
        api.maker.session.commit.assert_awaited_once()
        api.registry.reload.assert_awaited_once()

    async def test_rebinding_to_another_channel_forgets_the_old_cursor(self) -> None:
        api = _Api(row=_row(channel_id=999, last_scanned_message_id=500))

        await api.channel("upsert", {"channel_id": CHANNEL})

        fields = api.channels.update_fields.await_args.args[2]
        self.assertEqual(fields["channel_id"], int(CHANNEL))
        self.assertIsNone(fields["last_scanned_message_id"])

        api = _Api(row=_row(last_scanned_message_id=500))
        await api.channel("upsert", {"channel_id": CHANNEL, "is_active": False})
        self.assertNotIn("last_scanned_message_id", api.channels.update_fields.await_args.args[2])


class ChannelBackfillAndDeleteTests(IsolatedAsyncioTestCase):
    async def test_an_unbound_tournament_has_nothing_to_backfill_or_delete(self) -> None:
        api = _Api()

        for action in ("backfill", "delete"):
            self.assertEqual((await api.channel(action))["error"]["code"], "not_found")
        api.bot.attachment_processor.process_channel_history.assert_not_called()
        api.registry.reload.assert_not_awaited()

    async def test_a_backfill_walks_the_bound_channels_history_without_its_cursor(self) -> None:
        api = _Api(row=_row(last_scanned_message_id=500))

        answer = await api.channel("backfill")

        self.assertEqual(answer["data"], {"message": "Backfill started: scanning channel history for match logs"})
        api.bot.attachment_processor.process_channel_history.assert_called_once_with(
            int(CHANNEL), TOURNAMENT, limit=rpc_api.BACKFILL_LIMIT
        )

    async def test_a_delete_unbinds_and_stops_watching(self) -> None:
        row = _row()
        api = _Api(row=row)

        answer = await api.channel("delete")

        self.assertEqual(answer, {"ok": True, "data": None})
        api.channels.delete.assert_awaited_once_with(api.maker.session, row)
        api.maker.session.commit.assert_awaited_once()
        api.registry.reload.assert_awaited_once()
