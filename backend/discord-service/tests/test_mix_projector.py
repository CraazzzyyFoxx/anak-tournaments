"""The mix projector: ``pickup_mix.changed`` -> the live cards of that mix, re-rendered.

The event is a fact with no state in it, so what lands on Discord is the card
rendered when the coalescing window closes -- a burst of join/leave clicks
becomes one edit showing the newest roster, whatever order the events arrived
in. A render equal to what the message already shows touches nothing, and a
re-render of a card whose own send is still on its way waits for it.
"""

import asyncio
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
from src.services.mix_projector import MixProjector  # noqa: E402
from tests.gateway_fakes import (  # noqa: E402
    FakeMessages,
    card,
    collect,
    http_error,
    message,
    renderer,
    row,
    session_maker,
)

_NO_WAIT = patch("src.services.mix_projector.EDIT_COALESCE_SECONDS", 0)


def _posted(ref: int, *, text: str = "4/10", message_id: int = 77, **fields):
    fields = {"status": "posted", "card_json": card(text).model_dump(mode="json"), **fields}
    return row(id=ref, discord_channel_id=555, message_id=message_id, **fields)


def _projector(rows: FakeMessages, render: AsyncMock) -> tuple[MixProjector, MagicMock, dict[int, MagicMock]]:
    """A projector over ``rows``, with one ``PartialMessage`` mock per Discord message id."""
    made: dict[int, MagicMock] = {}
    bot = MagicMock()
    bot.get_partial_messageable = MagicMock(
        side_effect=lambda channel_id: MagicMock(
            get_partial_message=MagicMock(side_effect=lambda mid: made.setdefault(mid, MagicMock(edit=AsyncMock())))
        )
    )
    projector = MixProjector(bot=bot, session_maker=session_maker(), messages=rows, renderer=render)
    return projector, bot, made


async def _drain(projector: MixProjector) -> None:
    while projector._tasks:
        await asyncio.gather(*list(projector._tasks.values()))


def _card_text(edit: MagicMock) -> str:
    (container,) = edit.await_args.kwargs["view"].to_components()
    return container["components"][0]["content"]


class CoalescingTests(IsolatedAsyncioTestCase):
    async def test_a_burst_on_one_row_becomes_one_edit_of_the_render_at_flush_time(self) -> None:
        rows = FakeMessages(_posted(1))
        render = renderer(Rendered(card("5/10")))
        projector, bot, made = _projector(rows, render)

        with _NO_WAIT:
            projector.schedule(1)
            projector.schedule(1)
            await _drain(projector)

        render.assert_awaited_once()
        bot.get_partial_messageable.assert_called_with(555)
        self.assertEqual(made[77].edit.await_count, 1)
        self.assertEqual(_card_text(made[77].edit), "5/10")
        self.assertEqual(
            made[77].edit.await_args.kwargs["allowed_mentions"].to_dict(), discord.AllowedMentions.none().to_dict()
        )
        self.assertEqual(rows.rows[1].card_json, card("5/10").model_dump(mode="json"))

    async def test_a_render_equal_to_what_the_message_shows_touches_nothing(self) -> None:
        """A rename in another mix, a click that changed nothing this card shows."""
        projector, bot, _made = _projector(FakeMessages(_posted(1, text="4/10")), renderer(Rendered(card("4/10"))))

        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)

        bot.get_partial_messageable.assert_not_called()

    async def test_join_leave_join_ends_on_the_last_state(self) -> None:
        """Every window renders afresh, so A -> B -> A lands on A."""
        rows = FakeMessages(_posted(1, text="4/10"))
        projector, _bot, made = _projector(rows, renderer(Rendered(card("5/10")), Rendered(card("4/10"))))

        with _NO_WAIT:
            for _ in range(2):
                projector.schedule(1)
                await _drain(projector)

        self.assertEqual(made[77].edit.await_count, 2)
        self.assertEqual(_card_text(made[77].edit), "4/10")
        self.assertEqual(rows.rows[1].card_json["text"], "4/10")

    async def test_two_rows_are_edited_separately(self) -> None:
        rows = FakeMessages(_posted(1, message_id=77), _posted(2, message_id=88))
        projector, _bot, made = _projector(rows, renderer(Rendered(card("6/10"))))

        with _NO_WAIT:
            projector.schedule(1)
            projector.schedule(2)
            await _drain(projector)

        self.assertEqual((made[77].edit.await_count, made[88].edit.await_count), (1, 1))

    async def test_a_ping_during_the_write_is_not_stranded(self) -> None:
        """Nothing else would pick that render up: the live post would stay a seat behind."""
        rows = FakeMessages(_posted(1))
        projector, _bot, made = _projector(rows, renderer(Rendered(card("5/10")), Rendered(card("6/10"))))

        async def click_mid_write(**kwargs) -> None:
            if made[77].edit.await_count == 1:
                projector.schedule(1)

        made[77] = MagicMock(edit=AsyncMock(side_effect=click_mid_write))

        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)

        self.assertEqual(made[77].edit.await_count, 2)
        self.assertEqual(_card_text(made[77].edit), "6/10")
        self.assertEqual((projector._pending, projector._tasks), (set(), {}))


class RowStateTests(IsolatedAsyncioTestCase):
    async def test_a_re_render_waits_for_a_send_that_has_not_landed_yet(self) -> None:
        """The event can be handled before the gateway posts the card; the row says so."""

        class _PostedOnSecondLook(FakeMessages):
            looks = 0

            async def get_for_update(self, session, row_id):
                self.looks += 1
                if self.looks == 2:
                    stored = self.rows[row_id]
                    stored.status, stored.discord_channel_id, stored.message_id = "posted", 555, 77
                return await super().get_for_update(session, row_id)

        rows = _PostedOnSecondLook(row(id=1, card_json=card("4/10").model_dump(mode="json")))
        projector, _bot, made = _projector(rows, renderer(Rendered(card("5/10"))))

        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)

        self.assertEqual(rows.looks, 2)
        self.assertEqual(_card_text(made[77].edit), "5/10")

    async def test_a_row_that_never_posts_is_dropped(self) -> None:
        """Bounded waiting: the next change re-renders the whole card anyway."""
        render = renderer()
        projector, bot, _made = _projector(FakeMessages(row(id=1)), render)

        with _NO_WAIT, patch("src.services.mix_projector.EDIT_PENDING_ATTEMPTS", 3):
            projector.schedule(1)
            await _drain(projector)

        render.assert_not_awaited()
        bot.get_partial_messageable.assert_not_called()
        self.assertEqual((projector._pending, projector._tasks), (set(), {}))

    async def test_a_row_past_posted_is_left_alone(self) -> None:
        for status in ("deleting", "deleted", "failed"):
            with self.subTest(status):
                render = renderer()
                projector, bot, _made = _projector(FakeMessages(_posted(1, status=status)), render)

                with _NO_WAIT:
                    projector.schedule(1)
                    await _drain(projector)

                render.assert_not_awaited()
                bot.get_partial_messageable.assert_not_called()

    async def test_history_and_a_vanished_mix_leave_the_message_as_it_is(self) -> None:
        for case, result in (("played lineup", KEEP), ("mix gone", None)):
            with self.subTest(case):
                projector, bot, _made = _projector(FakeMessages(_posted(1)), renderer(result))

                with _NO_WAIT:
                    projector.schedule(1)
                    await _drain(projector)

                bot.get_partial_messageable.assert_not_called()

    async def test_a_message_that_is_gone_closes_its_row(self) -> None:
        """Someone cleaned the channel; the platform stops believing the post exists."""
        rows = FakeMessages(_posted(1))
        projector, _bot, made = _projector(rows, renderer(Rendered(card("5/10"))))
        made[77] = MagicMock(edit=AsyncMock(side_effect=http_error(discord.NotFound, 404)))

        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)

        self.assertEqual(rows.rows[1].status, "deleted")

    async def test_a_refused_edit_is_not_recorded_so_the_next_change_tries_again(self) -> None:
        rows = FakeMessages(_posted(1, text="4/10"))
        projector, _bot, made = _projector(rows, renderer(Rendered(card("5/10"))))
        made[77] = MagicMock(edit=AsyncMock(side_effect=http_error(discord.Forbidden, 403)))

        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)

        self.assertEqual((rows.rows[1].status, rows.rows[1].card_json["text"]), ("posted", "4/10"))

    async def test_a_render_that_fails_costs_that_edit_only(self) -> None:
        """balancer-service down: logged, and the next event renders again."""
        projector, bot, _made = _projector(FakeMessages(_posted(1)), AsyncMock(side_effect=TimeoutError("rpc")))

        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)

        bot.get_partial_messageable.assert_not_called()
        self.assertEqual(projector._tasks, {})


class PictureTests(IsolatedAsyncioTestCase):
    async def _edit_kwargs(self, shown: dict, rendered: Rendered) -> dict:
        projector, _bot, made = _projector(FakeMessages(_posted(1, card_json=shown)), renderer(rendered))
        with _NO_WAIT:
            projector.schedule(1)
            await _drain(projector)
        return made[77].edit.await_args.kwargs

    async def test_a_new_picture_replaces_the_one_the_message_shows(self) -> None:
        upload = discord.File(io.BytesIO(b"png"), filename="lineup-b.png")
        new = card("### Lineup", image_url="attachment://lineup-b.png")
        old = card("### Lineup", image_url="attachment://lineup-a.png").model_dump(mode="json")

        kwargs = await self._edit_kwargs(old, Rendered(new, upload))

        self.assertEqual(kwargs["attachments"], [upload])

    async def test_the_same_picture_is_not_uploaded_again(self) -> None:
        """Seats changed, the drawing did not: re-uploading it would be a wasted megabyte."""
        old = card("### Lineup", image_url="attachment://lineup-a.png").model_dump(mode="json")

        kwargs = await self._edit_kwargs(old, Rendered(card("### Lineup 2", image_url="attachment://lineup-a.png")))

        self.assertNotIn("attachments", kwargs)

    async def test_a_card_that_became_text_drops_the_picture_it_used_to_show(self) -> None:
        """Discord keeps an attachment nobody edits away, even once the layout stops showing it."""
        old = card("### Lineup", image_url="attachment://lineup-a.png").model_dump(mode="json")

        kwargs = await self._edit_kwargs(old, Rendered(card("Mix closed")))

        self.assertEqual(kwargs["attachments"], [])


class TargetTests(IsolatedAsyncioTestCase):
    def _rows(self) -> FakeMessages:
        return FakeMessages(
            _posted(1),  # mix 42's old signup card, on its way out
            _posted(2),  # ... and its current one
            _posted(3, slot="lineup:0:1", kind="mix.lineup"),
            _posted(4, slot="lineup:1:1", kind="mix.lineup", status="deleted"),
            _posted(5, subject="mix:43"),
            _posted(6, subject="mix:44", workspace_id=8),
        )

    async def _scheduled(self, body: dict) -> list[int]:
        projector, _bot, _made = _projector(self._rows(), renderer())
        handler = collect(projector.register)["project_mix_cards"]
        with patch.object(projector, "schedule") as schedule:
            await handler(body, message())
        return [c.args[0] for c in schedule.call_args_list]

    async def test_a_mix_event_re_renders_its_newest_signup_card_and_every_live_lineup(self) -> None:
        scheduled = await self._scheduled({"workspace_id": 7, "custom_game_id": 42, "change": "roster"})

        self.assertEqual(scheduled, [2, 3])

    async def test_a_workspace_event_re_renders_the_newest_signup_card_of_every_mix_in_it(self) -> None:
        """A renamed player shows on every mix's roster; lineups keep the names their balance stored."""
        scheduled = await self._scheduled({"workspace_id": 7, "custom_game_id": None, "change": "member"})

        self.assertEqual(scheduled, [2, 5])
