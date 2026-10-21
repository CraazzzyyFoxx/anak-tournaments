"""The two pickup-mix cards and the lineup picture, and how :func:`src.render.render` builds them from balancer's view."""

from __future__ import annotations

import io
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

# See test_member_roles_rpc.py: importing `src.*` pulls in the service Settings,
# which needs the env block conftest.py installs.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import discord  # noqa: E402
from PIL import Image  # noqa: E402

from shared import models  # noqa: E402
from shared.schemas.rpc import RpcReply  # noqa: E402
from shared.services import discord_messages  # noqa: E402
from src.render import KEEP, render  # noqa: E402
from src.render.mix import SignupPlayer, lineup_card, lineup_picture, signup_card  # noqa: E402
from src.render.mix_lineup_image import render_png  # noqa: E402
from src.ui import SHORTCODE  # noqa: E402

BOARD_URL = "https://owt.example/balancer/mix/42"
NOW = datetime(2026, 10, 6, 18, 0, tzinfo=UTC)


def _document(*rosters: dict[str, list[tuple[str, int]]]) -> dict:
    """A stored lobby document with one option: a team per roster of ``(name, rating)`` seats."""
    players: dict[str, dict] = {}
    teams = []
    for roster in rosters:
        for bucket, seats in roster.items():
            for name, rating in seats:
                players.setdefault(name, {"name": name, "ratings": {}})["ratings"][bucket] = rating
        teams.append({"roster": {bucket: [name for name, _ in seats] for bucket, seats in roster.items()}})
    return {"players": players, "variants": [{"teams": teams}]}


def _lineup(**overrides):
    kwargs = {
        "mix_name": "Friday Scrim",
        "match_number": 1,
        "next_map": None,
        "points_per_win": None,
        "board_url": BOARD_URL,
        "image_filename": "lineup-abc.png",
    }
    kwargs.update(overrides)
    return lineup_card(**kwargs)


def _signup(**overrides):
    kwargs = {
        "mix_name": "Friday Scrim",
        "host_name": "Foxx",
        "board_url": BOARD_URL,
        "custom_game_id": 42,
        "self_signup": "pool",
        "status": "draft",
        "lobby_count": 1,
        "players": [],
        "updated_at": NOW,
    }
    kwargs.update(overrides)
    return signup_card(**kwargs)


def _player(
    role: str | None = None, name: str = "P", *, benched: bool = False, rank: int | None = None
) -> SignupPlayer:
    return SignupPlayer(name=name, role=role, benched=benched, rank=rank)


# ── the signup card ────────────────────────────────────────────────────────


def test_an_open_signup_card_names_the_mix_its_host_and_where_a_joiner_lands() -> None:
    card = _signup()

    assert card.text.startswith("## :owt_live: Запись на микс «Friday Scrim»")
    assert ":owt_host: Foxx" in card.text
    assert ":owt_pool: сразу в пул" in card.text
    assert "2 лобби" not in card.text
    assert card.accent_color == 0x14B8A6


def test_a_benched_signup_says_the_bench_and_marks_every_lobby() -> None:
    card = _signup(self_signup="benched", lobby_count=2)

    assert ":owt_bench: сначала на скамейку" in card.text
    assert ":owt_lobby_a::owt_lobby_b: 2 лобби" in card.text
    assert ":owt_lobby_a::owt_lobby_b::owt_lobby_c: 3 лобби" in _signup(lobby_count=3).text


def test_the_card_counts_the_roster_by_role_with_full_flex_under_its_icon() -> None:
    """A row with no role at all (an explicit empty order) is in no counter."""
    card = _signup(players=[_player(role) for role in ("tank", "damage", "support", "damage", "flex", "flex", None)])

    assert ":owt_players: **7** записано" in (card.details or "")
    assert ":owt_tank: 1 · :owt_damage: 2 · :owt_support: 1 · :owt_flex: 2" in (card.details or "")


def test_an_open_card_explains_the_two_clicks_and_stamps_when_it_was_rendered() -> None:
    details = _signup().details or ""

    assert "1. Нажмите «Записаться»" in details
    assert "Discord" in details and "Battle.net" in details
    assert f"<t:{int(NOW.timestamp())}:R>" in details


def test_an_open_card_carries_the_three_actions_with_their_emoji_and_the_board_link() -> None:
    card = _signup()

    assert [button.action for button in card.answers] == ["mix.join", "mix.roles", "mix.leave"]
    assert {button.target for button in card.answers} == {"42"}
    assert [button.style for button in card.answers] == ["success", "secondary", "danger"]
    assert [button.emoji for button in card.answers] == ["join", "edit", "leave"]
    assert all(button.disabled is False for button in card.answers)
    [[link]] = card.rows
    assert (link.url, link.emoji) == (BOARD_URL, "link")


def test_a_closed_card_greys_out_joining_but_still_lets_the_seated_leave() -> None:
    """The mix is still live, so whoever is in can check their seat or get out."""
    card = _signup(self_signup="closed", players=[_player("tank")])

    assert card.text.startswith("## :owt_lock: Запись на микс «Friday Scrim» закрыта")
    join, seat, leave = card.answers
    assert join.disabled is True
    assert (seat.disabled, leave.disabled) == (False, False)
    assert "Нажмите «Записаться»" not in (card.details or "")
    assert ":owt_players: **1** записано" in (card.details or "")


def test_a_finished_or_cancelled_mix_answers_nothing_at_all() -> None:
    done = _signup(status="completed")
    cancelled = _signup(status="cancelled", self_signup="pool")

    assert done.text.startswith("## :owt_lock: Микс «Friday Scrim» завершён")
    assert cancelled.text.startswith("## :owt_lock: Микс «Friday Scrim» отменён")
    assert done.answers == [] and cancelled.answers == []
    assert done.accent_color == 0x3B82F6
    # Nothing to sign up for, so the mode is not advertised any more.
    assert "сразу в пул" not in cancelled.text
    # The board link survives: the history is still worth reading.
    assert cancelled.rows[0][0].url == BOARD_URL


def test_the_card_escapes_a_mix_name_written_as_markdown() -> None:
    """Mix names are user input and the card is Discord markdown: an unescaped
    name reformats (or breaks) the whole post."""
    card = _signup(mix_name="**Friday** _mix_", host_name=None)

    assert "**Friday**" not in card.text
    assert r"\*\*Friday\*\*" in card.text
    assert ":owt_host: —" in card.text


def test_the_card_survives_a_mix_name_at_the_length_cap() -> None:
    """DiscordCard refuses past 4000 characters, and escaping can double a
    name's length -- a 255-character mix name must still produce a card."""
    assert len(_signup(mix_name="*" * 255).text) < 4000


def test_the_card_lists_one_player_a_line_with_role_badge_and_rank() -> None:
    """Who is in, as the balancer has them: the role they come for (flex only
    for Full Flex), the rank badge and the number -- pool and must-play
    together, the bench under its own heading. Names are user input, so
    escaped; a row with no role shows no role icon."""
    card = _signup(
        players=[
            _player("damage", "Ana", rank=2450),
            _player("flex", "Bob", benched=True, rank=4950),
            _player("support", "_Cid_"),
            _player(None, "Dee"),
        ]
    )

    assert (card.details or "").splitlines()[1:7] == [
        "**Игроки**",
        ":owt_damage: :owt_div_platinum_1: Ana · 2450",
        r":owt_support: \_Cid\_ · без ранга",
        "Dee · без ранга",
        ":owt_bench: **Скамейка**",
        ":owt_flex: :owt_div_champion_1: Bob · 4950",
    ]


def test_an_empty_roster_lists_nobody() -> None:
    details = _signup().details or ""

    assert "Игроки" not in details and "Скамейка" not in details


def test_a_full_roster_is_cut_at_what_discord_renders_and_counted_not_refused() -> None:
    """100 lines of emoji-heavy, escape-doubled names would blow Discord's 4000
    once the bot expands every shortcode to ``<:owt_name:id>``: the lists stop
    at their budget measured that way and say how many they left out."""
    card = _signup(
        players=[_player("tank", "*" * 32, rank=2500) for _ in range(90)]
        + [_player("flex", "x", benched=True, rank=2500) for _ in range(10)]
    )

    details = card.details or ""
    shortcodes = len(SHORTCODE.findall(card.text + details))
    assert len(card.text) + len(details) + 21 * shortcodes < 4000
    lines = details.splitlines()
    pool = lines[lines.index("**Игроки**") + 1 : lines.index(":owt_bench: **Скамейка**")]
    assert pool[-1] == f"-# и ещё {90 - (len(pool) - 1)}"
    # Whatever room the pool left, every benched player is shown or counted.
    bench = lines[lines.index(":owt_bench: **Скамейка**") + 1 :]
    shown = sum(1 for line in bench if line.startswith(":owt_flex:"))
    hidden = next((int(line.rsplit(" ", 1)[1]) for line in bench if line.startswith("-# и ещё")), 0)
    assert shown + hidden == 10


# ── the lineup card ────────────────────────────────────────────────────────


def test_the_lineup_headline_names_the_mix_and_the_match_about_to_be_played() -> None:
    assert _lineup(match_number=4).text.startswith("## :owt_vs: Friday Scrim · Игра 4")


def test_a_two_lobby_mix_says_which_lobby_the_lineup_is_for() -> None:
    """Both lobbies post into the same channel, so the card has to say which
    one it describes -- and each counts its own games."""
    assert "Friday Scrim · Лобби B · Игра 3" in _lineup(match_number=3, lobby_label="B").text


def test_the_lineup_carries_the_map_its_gamemode_and_the_points_at_stake() -> None:
    card = _lineup(next_map=("Busan", "Контроль"), points_per_win=25)

    assert ":owt_map: Busan · Контроль" in card.text
    assert ":owt_points: Победа: +25" in card.text


def test_the_lineup_says_so_before_anyone_rolled_a_map() -> None:
    card = _lineup(next_map=("Busan", None), points_per_win=0)

    assert ":owt_map: Busan" in card.text
    assert "Победа" not in card.text
    assert ":owt_map: Карта ещё не выбрана" in _lineup().text


def _picture(document: dict, **overrides):
    kwargs = {
        "mix_name": "Friday Scrim",
        "match_number": 1,
        "variant": document["variants"][0],
        "players": document["players"],
        "team_names": {},
        "next_map": None,
        "map_image": None,
        "points_per_win": None,
        "board_url": BOARD_URL,
    }
    kwargs.update(overrides)
    return lineup_picture(**kwargs)


def test_the_picture_seats_every_player_under_their_team_with_the_division_they_sit_in() -> None:
    document = _document(
        {"Tank": [("Ana", 3000)], "Damage": [("Bob", 2900), ("Cid", 2800)], "Support": [("Dee", 2700)]},
        {"Tank": [("Eve", 2600)]},
    )
    document["players"]["Dee"]["is_captain"] = True
    first, second = _picture(document, team_names={1: "Синие"}).teams

    assert (first.name, second.name) == ("Команда 1", "Синие")
    assert [(seat.role, seat.name, seat.rating, seat.captain) for seat in first.seats] == [
        ("tank", "Ana", 3000, False),
        ("damage", "Bob", 2900, False),
        ("damage", "Cid", 2800, False),
        ("support", "Dee", 2700, True),
    ]
    # The badge is the grid tier's own picture; the in-code ladder's site-relative path is resolved on the site.
    assert first.seats[0].division_icon == "https://owt.example/divisions/diamond-5.png"
    # The averages are of the numbers drawn, so their gap checks out on the picture.
    assert (first.average, second.average) == (2850, 2600)


def test_the_picture_carries_the_gap_the_points_and_the_maps_art() -> None:
    document = _document({"Tank": [("Ana", 3000)]}, {"Tank": [("Bob", 2900)]})
    picture = _picture(
        document, points_per_win=25, next_map=("Busan", "Контроль"), map_image="https://s3.example/busan.jpg"
    )

    assert picture.pills == ("Разрыв по рангу 100", "Победа +25")
    assert (picture.map_name, picture.gamemode) == ("Busan", "Контроль")
    # Everything fetched before drawing: the map's art and one badge per distinct tier.
    assert picture.image_urls == {
        "https://s3.example/busan.jpg",
        "https://owt.example/divisions/diamond-5.png",
        "https://owt.example/divisions/emerald-1.png",
    }
    # Art for a map nobody rolled is not drawn.
    assert _picture(document, map_image="https://s3.example/busan.jpg").map_image is None


def test_the_picture_names_the_same_lineup_the_same_file_and_a_swap_a_new_one() -> None:
    """The file name is how the projector tells an unchanged card from a changed one."""
    document = _document({"Tank": [("Ana", 3000)]}, {"Tank": [("Bob", 2900)]})
    swapped = _document({"Tank": [("Bob", 2900)]}, {"Tank": [("Ana", 3000)]})

    assert (
        _picture(document).filename
        == _picture(_document({"Tank": [("Ana", 3000)]}, {"Tank": [("Bob", 2900)]})).filename
    )
    assert _picture(document).filename != _picture(swapped).filename
    assert _picture(document).filename != _picture(document, next_map=("Busan", None)).filename


def test_the_picture_draws_as_a_card_sized_png_whatever_the_names_and_whatever_failed_to_load() -> None:
    """Guards the asset paths too: a missing font fails here, not in the projector.
    A picture that did not load, or loaded as garbage, is left out, not fatal."""
    document = _document({"Goalie": [("Ana" * 40, 3000)]}, {"Tank": [("Сережа Спардович", 900)]})
    picture = _picture(
        document,
        points_per_win=25,
        lobby_label="B",
        next_map=("Busan", "Контроль"),
        map_image="https://s3.example/busan.jpg",
    )

    for images in ({}, dict.fromkeys(picture.image_urls, b"not an image")):
        with Image.open(io.BytesIO(render_png(picture, images))) as image:
            assert (image.format, image.size) == ("PNG", (1200, 630))


def test_the_card_shows_its_picture_and_pings_the_seated_players_it_was_given_ids_for() -> None:
    card = _lineup()

    assert card.image_url == "attachment://lineup-abc.png"
    assert card.attachment_name == "lineup-abc.png"
    assert card.details is None
    assert _lineup(mentions=["111", "222"]).details == "-# :owt_players: <@111> <@222>"


def test_only_a_card_given_a_voice_target_offers_to_move_the_lobby() -> None:
    """The two voice buttons are the newest card's; an older one carries none."""
    card = _lineup(voice_target="42-0")

    assert [(button.action, button.target) for button in card.answers] == [
        ("voice.move", "42-0"),
        ("voice.return", "42-0"),
    ]
    assert [button.style for button in card.answers] == ["primary", "secondary"]
    assert _lineup().answers == []


# ── render(): the mix rows, from balancer's view ───────────────────────────


def _view(**lineup: Any) -> dict:
    """``rpc.balancer.custom.discord_view`` for mix 42, with lobby 0's lineup for game 3."""
    document = _document({"Tank": [("Ana", 3000)]}, {"Tank": [("Bob", 2900)]})
    return {
        "custom_game_id": 42,
        "workspace_id": 7,
        "status": "draft",
        "board_url": BOARD_URL,
        "signup": {
            "mix_name": "Friday Scrim",
            "host_name": "Foxx",
            "self_signup": "pool",
            "status": "draft",
            "lobby_count": 1,
            "players": [{"name": "Ana", "role": "damage", "benched": False, "rank": 2450}],
            "updated_at": NOW.isoformat(),
        },
        "lineups": [
            {
                "lobby_index": 0,
                "match_number": 3,
                "current": True,
                "variant": document["variants"][0],
                "players": document["players"],
                "team_names": {"1": "Синие"},
                "next_map": ["Busan", "Контроль"],
                "map_image": None,
                "points_per_win": 25,
                "lobby_label": None,
                "mention_user_ids": ["111"],
                "voice_target": "42-0",
                **lineup,
            }
        ],
    }


def _message(row_id: int, slot: str, **fields: Any) -> models.DiscordMessage:
    kind = "mix.signup" if slot == "signup" else "mix.lineup"
    return models.DiscordMessage(
        id=row_id,
        channel="discord_channel",
        target="555",
        subject="mix:42",
        slot=slot,
        kind=kind,
        status=fields.pop("status", "posted"),
        workspace_id=7,
        **fields,
    )


class RenderMixRowTests(IsolatedAsyncioTestCase):
    async def _render(
        self, row: models.DiscordMessage, reply: RpcReply, live: list[models.DiscordMessage] = ()
    ) -> tuple[Any, AsyncMock, AsyncMock]:
        """``render`` of ``row`` with the view answering ``reply`` and ``live`` the subject's live rows."""
        request = AsyncMock(return_value=reply)
        draw = AsyncMock(side_effect=lambda picture: discord.File(io.BytesIO(b"png"), filename=picture.filename))
        with (
            patch("src.render.request_rpc", request),
            patch("src.render._draw", draw),
            patch.object(discord_messages.repository, "for_subject", AsyncMock(return_value=list(live) or [row])),
        ):
            result = await render(None, row, broker="broker")
        return result, request, draw

    async def test_a_signup_row_is_the_signup_card_of_the_mix_as_balancer_sees_it(self) -> None:
        result, request, _ = await self._render(_message(1, "signup"), RpcReply(ok=True, data=_view()))

        self.assertEqual(request.await_args.args[1], {"custom_game_id": 42, "lineups": []})
        self.assertEqual(request.await_args.args[2], "rpc.balancer.custom.discord_view")
        self.assertTrue(result.card.text.startswith("## :owt_live: Запись на микс «Friday Scrim»"))
        self.assertIn(":owt_damage: :owt_div_platinum_1: Ana · 2450", result.card.details)
        self.assertIn(f"<t:{int(NOW.timestamp())}:R>", result.card.details)
        self.assertEqual(result.card.rows[0][0].url, BOARD_URL)
        self.assertIsNone(result.file)
        self.assertEqual(result.allowed_mentions.to_dict(), discord.AllowedMentions.none().to_dict())

    async def test_a_mix_balancer_no_longer_knows_has_nothing_to_show(self) -> None:
        missing = RpcReply(ok=False, error={"code": "not_found", "message": "gone"})

        result, _, _ = await self._render(_message(1, "signup"), missing)

        self.assertIsNone(result)

    async def test_an_unreachable_balancer_is_an_outage_not_an_answer(self) -> None:
        down = RpcReply(ok=False, error={"code": "internal", "message": "boom"})

        with self.assertRaises(RuntimeError):
            await self._render(_message(1, "signup"), down)

    async def test_the_lobbys_newest_lineup_moves_people_and_pings_its_players(self) -> None:
        row = _message(5, "lineup:0:3", status="pending")

        result, request, draw = await self._render(row, RpcReply(ok=True, data=_view()))

        self.assertEqual(
            request.await_args.args[1], {"custom_game_id": 42, "lineups": [{"lobby_index": 0, "match_number": 3}]}
        )
        self.assertTrue(result.card.text.startswith("## :owt_vs: Friday Scrim · Игра 3"))
        self.assertEqual([button.target for button in result.card.answers], ["42-0", "42-0"])
        self.assertEqual(result.card.details, "-# :owt_players: <@111>")
        self.assertEqual(result.allowed_mentions.to_dict(), {"parse": ["users"]})
        # Drawn, and named after what it shows.
        (picture,) = draw.await_args.args
        self.assertEqual(picture.teams[1].name, "Синие")
        self.assertEqual(result.file.filename, result.card.attachment_name)

    async def test_an_older_lineup_of_the_lobby_carries_no_voice_buttons(self) -> None:
        older, newer = _message(5, "lineup:0:3"), _message(6, "lineup:0:3", status="pending")
        other_lobby = _message(7, "lineup:1:1")

        result, _, _ = await self._render(older, RpcReply(ok=True, data=_view()), [older, newer, other_lobby])

        self.assertEqual(result.card.answers, [])

    async def test_the_picture_the_message_already_shows_is_not_drawn_again(self) -> None:
        first, _, _ = await self._render(_message(5, "lineup:0:3"), RpcReply(ok=True, data=_view()))
        shown = _message(5, "lineup:0:3", card_json=first.card.model_dump(mode="json"))

        again, _, draw = await self._render(shown, RpcReply(ok=True, data=_view()))

        draw.assert_not_awaited()
        self.assertIsNone(again.file)
        self.assertEqual(again.card, first.card)

    async def test_a_played_lineup_stays_as_it_was_posted_but_gives_up_its_voice_buttons(self) -> None:
        """A recorded match is history -- unless a newer card of the lobby now owns the buttons."""
        played = RpcReply(ok=True, data=_view(current=False))
        posted, _, _ = await self._render(_message(5, "lineup:0:3"), RpcReply(ok=True, data=_view()))
        shown = posted.card.model_dump(mode="json")
        newest = _message(5, "lineup:0:3", card_json=shown)
        older = _message(5, "lineup:0:3", card_json=shown)

        kept, _, _ = await self._render(newest, played)
        stripped, _, draw = await self._render(older, played, [older, _message(6, "lineup:0:4")])

        self.assertIs(kept, KEEP)
        self.assertEqual(stripped.card, posted.card.model_copy(update={"answers": []}))
        self.assertIsNone(stripped.file)
        draw.assert_not_awaited()

    async def test_a_kind_nothing_renders_is_nothing_to_show(self) -> None:
        row = _message(1, "signup")
        row.kind = "mix.unknown"

        result, request, _ = await self._render(row, RpcReply(ok=True, data=_view()))

        self.assertIsNone(result)
        request.assert_not_awaited()
