"""A ``delete`` command: the message goes, and its row is closed.

A host deleting a mix post (or a whole mix) marks its ``discord_message`` rows
``deleting`` and queues one command per row. The bot is what closes them: the
message goes, the row becomes ``deleted``, and the page showing the mix hears
about it. The two awkward cases are a message somebody already removed by hand
(still a success -- it is gone either way) and a row whose own send has not
landed yet, which is left ``deleting`` for the send handler to finish.
"""

import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock

# See test_member_roles_rpc.py: importing `src.*` pulls in the service Settings,
# which needs the env block conftest.py installs.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import discord  # noqa: E402

from tests.gateway_fakes import FakeMessages, gateway, http_error, message, row  # noqa: E402


def _handler(rows: FakeMessages, *, delete: AsyncMock | None = None):
    partial = MagicMock(delete=delete or AsyncMock())
    bot = MagicMock(
        wait_until_ready=AsyncMock(),
        get_partial_messageable=MagicMock(return_value=MagicMock(get_partial_message=MagicMock(return_value=partial))),
    )
    handle, _ = gateway(bot=bot, messages=rows)
    return handle, bot, partial


def _body(*, ref: int = 1) -> dict:
    return {"event_type": "discord_command", "action": "delete", "message_ref": ref}


class DeleteCommandTests(IsolatedAsyncioTestCase):
    async def test_a_posted_message_is_deleted_and_its_row_closed(self) -> None:
        rows = FakeMessages(row(status="deleting", discord_channel_id=555, message_id=77))
        handle, bot, partial = _handler(rows)
        msg = message()

        await handle(_body(), msg)

        bot.get_partial_messageable.assert_called_once_with(555)
        bot.get_partial_messageable.return_value.get_partial_message.assert_called_once_with(77)
        partial.delete.assert_awaited_once()
        self.assertEqual(rows.rows[1].status, "deleted")
        msg.ack.assert_awaited_once()
        msg.nack.assert_not_awaited()

    async def test_a_message_already_gone_still_closes_the_row(self) -> None:
        """Someone removed it by hand: the host asked for it gone, and it is."""
        rows = FakeMessages(row(status="deleting", discord_channel_id=555, message_id=77))
        handle, _bot, _partial = _handler(rows, delete=AsyncMock(side_effect=http_error(discord.NotFound, 404)))
        msg = message()

        await handle(_body(), msg)

        self.assertEqual(rows.rows[1].status, "deleted")
        msg.ack.assert_awaited_once()

    async def test_a_refusal_leaves_the_row_deleting_without_requeueing(self) -> None:
        """A missing permission fails identically on every retry; the page keeps saying "deleting"."""
        rows = FakeMessages(row(status="deleting", discord_channel_id=555, message_id=77))
        handle, _bot, _partial = _handler(rows, delete=AsyncMock(side_effect=http_error(discord.Forbidden, 403)))
        msg = message()

        await handle(_body(), msg)

        self.assertEqual(rows.rows[1].status, "deleting")
        msg.ack.assert_awaited_once()
        msg.nack.assert_not_awaited()
        msg.reject.assert_not_awaited()

    async def test_a_row_whose_send_has_not_landed_is_left_to_the_send_handler(self) -> None:
        rows = FakeMessages(row(status="deleting"))  # no Discord ids yet
        handle, bot, partial = _handler(rows)
        msg = message()

        await handle(_body(), msg)

        bot.get_partial_messageable.assert_not_called()
        partial.delete.assert_not_awaited()
        self.assertEqual(rows.rows[1].status, "deleting")
        msg.ack.assert_awaited_once()

    async def test_a_row_that_is_gone_is_rejected(self) -> None:
        handle, _bot, partial = _handler(FakeMessages())
        msg = message()

        await handle(_body(), msg)

        partial.delete.assert_not_awaited()
        msg.reject.assert_awaited_once()
