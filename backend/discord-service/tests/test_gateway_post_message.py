"""A ``send`` command for a channel row: the bot renders the row and posts it.

The command names a ``discord_message`` row and nothing else, and the bot is
the only process that hears Discord answer, so the handler is really three
decisions: whether this row still has to be sent at all (a redelivery, or a
delete that got there first), whether the channel the row names may be posted
to (it must sit in the row's workspace guild), and what the row says
afterwards -- posted with the ids a later edit or delete needs and the card it
shows, or failed with the reason the host reads. The ack/reject decision rides
along: a wrong one either drops the message silently or requeues it forever.
"""

import io
import sys
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, patch

# See test_member_roles_rpc.py: importing `src.*` pulls in the service Settings,
# which needs the env block conftest.py installs.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import discord  # noqa: E402

from src.render import KEEP, Rendered  # noqa: E402
from tests.gateway_fakes import (  # noqa: E402
    FakeMessages,
    card,
    gateway,
    http_error,
    message,
    renderer,
    row,
    sent,
    session_maker,
    text_channel,
)

_PNG = b"\x89PNG\r\n\x1a\nlineup-bytes"


def _handler(channel=None, *, rows=None, maker=None, render=None, projector=None):
    processor = MagicMock(get_text_channel=AsyncMock(return_value=channel))
    handle, _ = gateway(
        processor=processor,
        messages=rows or FakeMessages(row()),
        maker=maker,
        render=render,
        projector=projector,
    )
    return handle


def _body(ref: int = 1) -> dict:
    return {"event_type": "discord_command", "action": "send", "message_ref": ref}


class PostCommandTests(IsolatedAsyncioTestCase):
    async def test_posts_the_rendered_card_and_records_where_it_landed(self) -> None:
        """The ids on the row are what every later edit and delete is resolved from;
        the card is what the next render compares against."""
        rows = FakeMessages(row())
        channel = text_channel(send=AsyncMock(return_value=sent(channel_id=555, message_id=9001)))
        render = renderer(Rendered(card("### 4/10")))
        msg = message()

        await _handler(channel, rows=rows, render=render)(_body(), msg)

        kwargs = channel.send.await_args.kwargs
        self.assertTrue(kwargs["view"].has_components_v2())
        (container,) = kwargs["view"].to_components()
        self.assertEqual(container["accent_color"], 0x14B8A6)
        self.assertEqual(container["components"][0]["content"], "### 4/10")
        self.assertIs(render.await_args.args[1], rows.rows[1])
        stored = rows.rows[1]
        self.assertEqual((stored.status, stored.discord_channel_id, stored.message_id), ("posted", 555, 9001))
        self.assertEqual(stored.card_json, card("### 4/10").model_dump(mode="json"))
        msg.ack.assert_awaited_once()
        msg.reject.assert_not_awaited()

    async def test_the_row_id_is_the_nonce_so_a_resend_after_a_crash_is_the_same_message(self) -> None:
        """A crash between the send and ``mark_posted`` leaves the row pending; Discord
        answers the repeat with the message the first send created."""
        channel = text_channel()

        await _handler(channel, rows=FakeMessages(row(id=31)))(_body(31), message())

        self.assertEqual(channel.send.await_args.kwargs["nonce"], 31)

    async def test_the_page_showing_the_mix_is_told_the_post_changed(self) -> None:
        rows = FakeMessages(row(workspace_id=7))
        msg = message()

        with patch("src.rabbit.gateway.emit_changed", AsyncMock()) as emit:
            await _handler(text_channel(), rows=rows)(_body(), msg)

        emit.assert_awaited_once()
        self.assertIs(emit.await_args.args[1], rows.rows[1])

    async def test_the_picture_the_card_shows_is_uploaded_beside_it(self) -> None:
        channel = text_channel()
        upload = discord.File(io.BytesIO(_PNG), filename="lineup.png")
        shown = card("### Составы", image_url="attachment://lineup.png")

        await _handler(channel, render=renderer(Rendered(shown, upload)))(_body(), message())

        kwargs = channel.send.await_args.kwargs
        self.assertIs(kwargs["file"], upload)
        (container,) = kwargs["view"].to_components()
        gallery = container["components"][-1]
        self.assertEqual(gallery["items"][0]["media"]["url"], "attachment://lineup.png")

    async def test_mentions_are_what_the_renderer_allows(self) -> None:
        """Off for a notification (user-written names); users only for a lineup."""
        lineup = discord.AllowedMentions(everyone=False, roles=False, users=True, replied_user=False)
        for case, allowed, expected in (
            ("default", Rendered(card("@everyone")), discord.AllowedMentions.none().to_dict()),
            ("lineup", Rendered(card("<@7> @everyone"), allowed_mentions=lineup), {"parse": ["users"]}),
        ):
            with self.subTest(case):
                channel = text_channel()

                await _handler(channel, render=renderer(allowed))(_body(), message())

                self.assertEqual(channel.send.await_args.kwargs["allowed_mentions"].to_dict(), expected)

    async def test_a_channel_outside_the_workspace_guild_is_refused_before_anything_renders(self) -> None:
        """The bot sits in every workspace's guild; a channel id from another one is never posted to."""
        for case, channel, maker in (
            ("other guild", text_channel(guild_id=1234), session_maker()),
            ("no guild linked", text_channel(), session_maker(guild_id=None)),
            ("not a guild channel", MagicMock(send=AsyncMock(), guild=None), session_maker()),
        ):
            with self.subTest(case):
                rows = FakeMessages(row(workspace_id=7))
                render = renderer()
                msg = message()

                with patch("src.rabbit.gateway.emit_changed", AsyncMock()):
                    await _handler(channel, rows=rows, maker=maker, render=render)(_body(), msg)

                channel.send.assert_not_awaited()
                render.assert_not_awaited()
                self.assertEqual(
                    (rows.rows[1].status, rows.rows[1].error),
                    ("failed", "channel is not in the workspace's Discord guild"),
                )
                msg.reject.assert_awaited_once()
                msg.ack.assert_not_awaited()

    async def test_a_missing_channel_fails_the_row_and_is_rejected(self) -> None:
        rows = FakeMessages(row())
        msg = message()

        await _handler(None, rows=rows)(_body(), msg)

        self.assertEqual(rows.rows[1].status, "failed")
        self.assertIn("channel", rows.rows[1].error)
        msg.reject.assert_awaited_once()
        msg.ack.assert_not_awaited()

    async def test_nothing_to_render_fails_the_row_and_is_acked(self) -> None:
        """A mix deleted since, or a lineup whose match is already played: no retry changes it."""
        for case, result in (("gone", None), ("history", KEEP)):
            with self.subTest(case):
                rows = FakeMessages(row())
                channel = text_channel()
                msg = message()

                await _handler(channel, rows=rows, render=renderer(result))(_body(), msg)

                channel.send.assert_not_awaited()
                self.assertEqual((rows.rows[1].status, rows.rows[1].error), ("failed", "nothing to render"))
                msg.ack.assert_awaited_once()
                msg.reject.assert_not_awaited()

    async def test_a_render_that_cannot_reach_balancer_is_requeued(self) -> None:
        """An outage is not an answer: the row stays pending for the retry."""
        rows = FakeMessages(row())
        channel = text_channel()
        msg = message()
        render = AsyncMock(side_effect=TimeoutError("rpc.balancer.custom.discord_view"))

        with self.assertRaises(TimeoutError):
            await _handler(channel, rows=rows, render=render)(_body(), msg)

        channel.send.assert_not_awaited()
        self.assertEqual(rows.rows[1].status, "pending")
        msg.nack.assert_awaited_once()
        msg.ack.assert_not_awaited()

    async def test_a_refusal_fails_the_row_with_its_reason(self) -> None:
        """Silence would read as "still posting"; the mix page shows why it never will."""
        refusals = {
            "forbidden": (text_channel(send=AsyncMock(side_effect=http_error(discord.Forbidden, 403))), "permission"),
            "payload": (text_channel(send=AsyncMock(side_effect=http_error(discord.HTTPException, 400))), "refused"),
        }
        for case, (channel, expected) in refusals.items():
            with self.subTest(case):
                rows = FakeMessages(row())
                msg = message()

                await _handler(channel, rows=rows)(_body(), msg)

                self.assertEqual(rows.rows[1].status, "failed")
                self.assertIn(expected, rows.rows[1].error)
                self.assertLessEqual(len(rows.rows[1].error), 500)
                msg.reject.assert_awaited_once()
                msg.ack.assert_not_awaited()
                msg.nack.assert_not_awaited()

    async def test_a_redelivered_command_sends_nothing(self) -> None:
        """The row already says posted: nothing de-duplicates the queue but this check."""
        rows = FakeMessages(row(status="posted", discord_channel_id=555, message_id=9001))
        channel = text_channel()
        render = renderer()
        msg = message()

        await _handler(channel, rows=rows, render=render)(_body(), msg)

        channel.send.assert_not_awaited()
        render.assert_not_awaited()
        self.assertEqual(rows.rows[1].message_id, 9001)
        msg.ack.assert_awaited_once()

    async def test_a_delete_that_overtook_the_send_cancels_it(self) -> None:
        """The delete acked on the promise that this handler closes the row instead of sending."""
        rows = FakeMessages(row(status="deleting"))
        channel = text_channel()
        msg = message()

        await _handler(channel, rows=rows)(_body(), msg)

        channel.send.assert_not_awaited()
        self.assertEqual(rows.rows[1].status, "deleted")
        msg.ack.assert_awaited_once()

    async def test_a_delete_landing_mid_send_takes_the_message_back(self) -> None:
        """The row moved to ``deleting`` while Discord was answering; the card cannot stay."""
        rows = FakeMessages(row())
        landed = sent()

        async def send_while_a_delete_lands(**kwargs):
            rows.rows[1].status = "deleting"
            return landed

        channel = text_channel(send=AsyncMock(side_effect=send_while_a_delete_lands))
        msg = message()

        await _handler(channel, rows=rows)(_body(), msg)

        landed.delete.assert_awaited_once()
        self.assertEqual(rows.rows[1].status, "deleted")
        self.assertIsNone(rows.rows[1].message_id)
        msg.ack.assert_awaited_once()

    async def test_a_command_whose_row_is_gone_is_rejected(self) -> None:
        channel = text_channel()
        msg = message()

        await _handler(channel, rows=FakeMessages())(_body(), msg)

        channel.send.assert_not_awaited()
        msg.reject.assert_awaited_once()
        msg.nack.assert_not_awaited()

    async def test_a_database_failure_after_the_send_does_not_repost(self) -> None:
        """The card is already in the channel: a nack would post it twice."""
        channel = text_channel()
        msg = message()
        maker = session_maker(commit=AsyncMock(side_effect=RuntimeError("database gone")))

        await _handler(channel, maker=maker)(_body(), msg)

        channel.send.assert_awaited_once()
        msg.ack.assert_awaited_once()
        msg.nack.assert_not_awaited()

    async def test_a_command_of_the_old_shape_is_rejected(self) -> None:
        msg = message()

        await _handler(text_channel())({**_body(), "action": "post_message"}, msg)

        msg.reject.assert_awaited_once()


class LineupSendTests(IsolatedAsyncioTestCase):
    async def test_a_new_lineup_takes_the_voice_buttons_from_the_lobbys_older_cards(self) -> None:
        """Only the newest card of a lobby moves people: the others are re-rendered without
        the buttons -- not the other lobby's, not the signup card, not the new one."""
        rows = FakeMessages(
            row(id=1, slot="signup", status="posted"),
            row(id=2, slot="lineup:0:1", kind="mix.lineup", status="posted"),
            row(id=3, slot="lineup:1:1", kind="mix.lineup", status="posted"),
            row(id=4, slot="lineup:0:2", kind="mix.lineup", status="deleted"),
            row(id=5, slot="lineup:0:3", kind="mix.lineup"),
        )
        projector = MagicMock()

        await _handler(text_channel(), rows=rows, projector=projector)(_body(5), message())

        self.assertEqual(rows.rows[5].status, "posted")
        self.assertEqual([c.args[0] for c in projector.schedule.call_args_list], [2])

    async def test_a_signup_post_leaves_every_lineup_alone(self) -> None:
        rows = FakeMessages(row(id=1), row(id=2, slot="lineup:0:1", kind="mix.lineup", status="posted"))
        projector = MagicMock()

        await _handler(text_channel(), rows=rows, projector=projector)(_body(1), message())

        projector.schedule.assert_not_called()
