"""``DiscordClient``: every Discord read is one RPC to discord-service, nothing else.

Stdlib unittest like its siblings. The broker is a mock whose ``request``
returns a FastStream-shaped message (``decode()`` hands back the body).
"""

from __future__ import annotations

import asyncio
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

from shared.messaging.config import DISCORD_GUILD_ROLES_QUEUE, DISCORD_MEMBER_ROLES_QUEUE, DISCORD_VOICE_MOVE_QUEUE
from shared.schemas.rpc import rpc_error, rpc_ok
from shared.services.discord_client import DiscordClient
from shared.services.discord_errors import (
    DiscordError,
    DiscordForbidden,
    DiscordNotConfigured,
    DiscordUnavailable,
    MemberNotFound,
)


def _reply(body):
    return MagicMock(decode=AsyncMock(return_value=body))


def _broker(*replies):
    broker = AsyncMock()
    broker.request.side_effect = list(replies)
    return broker


class TestMembers(IsolatedAsyncioTestCase):
    async def test_prefetch_serves_every_member_read_from_one_rpc(self):
        broker = _broker(
            _reply(
                rpc_ok(
                    {
                        "guild_role_ids": ["1", "2"],
                        "members": {"a": {"found": True, "roles": ["2"]}, "b": {"found": False, "roles": []}},
                    }
                )
            )
        )
        client = DiscordClient(broker=broker)

        await client.prefetch("g", ["b", "a", "a", ""])
        assert await client.member_roles("g", "a") == ["2"]
        with self.assertRaises(MemberNotFound):
            await client.member_roles("g", "b")
        # The role-id set rode along in the batch: no second RPC for it.
        assert await client.guild_role_ids("g") == {"1", "2"}

        broker.request.assert_awaited_once()
        assert broker.request.await_args.args[:2] == (
            {"guild_id": "g", "user_ids": ["a", "b"]},
            DISCORD_MEMBER_ROLES_QUEUE,
        )

    async def test_prefetch_of_nobody_asks_nothing(self):
        broker = _broker()
        await DiscordClient(broker=broker).prefetch("g", ["", None])  # type: ignore[list-item]
        broker.request.assert_not_awaited()

    async def test_an_unknown_member_is_asked_about_once(self):
        broker = _broker(_reply(rpc_ok({"guild_role_ids": [], "members": {"a": {"found": True, "roles": ["7"]}}})))
        client = DiscordClient(broker=broker)

        assert await client.member_roles("g", "a") == ["7"]
        assert await client.member_roles("g", "a") == ["7"]
        broker.request.assert_awaited_once()

    async def test_a_member_the_bot_does_not_mention_is_not_found(self):
        client = DiscordClient(broker=_broker(_reply(rpc_ok({"guild_role_ids": [], "members": {}}))))
        with self.assertRaises(MemberNotFound):
            await client.member_roles("g", "a")


class TestErrors(IsolatedAsyncioTestCase):
    async def test_no_broker_is_not_configured(self):
        client = DiscordClient()
        with self.assertRaises(DiscordNotConfigured):
            await client.member_roles("g", "a")
        with self.assertRaises(DiscordNotConfigured):
            await client.voice_move("5", category_id="10", moves=[], drain=None)

    async def test_a_transport_failure_or_silence_is_unavailable(self):
        for failure in (RuntimeError("no broker"), TimeoutError("no answer"), _reply("not an envelope")):
            with self.assertRaises(DiscordUnavailable, msg=repr(failure)):
                await DiscordClient(broker=_broker(failure)).guild_roles("g")

    async def test_peer_errors_keep_their_meaning(self):
        """``not_found``: the bot is not in that guild -- an organizer fault, not an outage."""
        cases = {
            "not_found": DiscordForbidden,
            "bad_request": DiscordError,
            "internal": DiscordUnavailable,
        }
        for code, expected in cases.items():
            client = DiscordClient(broker=_broker(_reply(rpc_error(code, "nope"))))
            with self.assertRaises(DiscordError, msg=code) as raised:
                await client.member_roles("g", "a")
            assert type(raised.exception) is expected, code


class TestGuildReads(IsolatedAsyncioTestCase):
    async def test_guild_role_ids_are_fetched_once_for_a_concurrent_batch(self):
        calls = 0

        async def request(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0)
            return _reply(rpc_ok({"roles": [{"id": "1"}, {"id": 2}]}))

        broker = AsyncMock()
        broker.request.side_effect = request
        client = DiscordClient(broker=broker)

        results = await asyncio.gather(*(client.guild_role_ids("g") for _ in range(5)))

        assert results == [{"1", "2"}] * 5
        assert calls == 1
        assert broker.request.await_args.args[:2] == ({"guild_id": "g"}, DISCORD_GUILD_ROLES_QUEUE)

    async def test_guild_reads_hand_back_the_bots_own_shapes(self):
        roles = [{"id": "2", "name": "high", "color": "#0000ff", "position": 5, "managed": True}]
        channels = [{"id": "11", "name": "b", "type": "text", "missing_permissions": ["send_messages"]}]
        client = DiscordClient(broker=_broker(_reply(rpc_ok({"roles": roles})), _reply(rpc_ok({"channels": channels}))))

        assert await client.guild_roles("g") == roles
        assert await client.guild_channels("g") == channels


class TestVoiceMove(IsolatedAsyncioTestCase):
    async def test_the_bot_answers_per_person_for_the_documented_body(self):
        broker = _broker(_reply(rpc_ok({"results": [{"discord_user_id": "7", "status": "moved"}]})))

        results = await DiscordClient(broker=broker).voice_move(
            "5",
            category_id="10",
            moves=[{"discord_user_id": "7", "channel_id": "2"}],
            drain={"channel_ids": ["2"], "to_channel_id": "1"},
        )

        assert results == [{"discord_user_id": "7", "status": "moved"}]
        assert broker.request.await_args.args[:2] == (
            {
                "guild_id": "5",
                "category_id": "10",
                "moves": [{"discord_user_id": "7", "channel_id": "2"}],
                "drain": {"channel_ids": ["2"], "to_channel_id": "1"},
            },
            DISCORD_VOICE_MOVE_QUEUE,
        )

    async def test_a_dead_broker_is_unavailable_not_an_empty_move(self):
        with self.assertRaises(DiscordUnavailable):
            await DiscordClient(broker=_broker(TimeoutError("no answer"))).voice_move(
                "5", category_id="10", moves=[], drain=None
            )
