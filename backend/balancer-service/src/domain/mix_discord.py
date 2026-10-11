"""What the Discord messages of a pickup mix say: the signup card and the lineup card.

Pure domain: no I/O, no ORM, no async. The caller (custom game service) resolves
the mix name, its roster, the next map with its gamemode, the team-name
overrides and the Discord ids to ping, then hands them here; discord-service
owns the transport and this owns the words.

Both cards are Components V2 ``DiscordCard``s and both are Russian: a channel
has no per-reader locale, unlike the ephemeral replies the bot renders per user.
Emoji are written as ``:owt_<name>:`` shortcodes (``shared.domain.discord_ui``)
which the bot swaps for its uploaded application emoji.

The signup card is LIVE: the message the platform posted it as is a
``discord_message`` row (``subject='mix:<id>'``, ``slot='signup'``) and every
mutation that changes something it shows -- a count, a name, who is benched --
announces itself, after which the projector
(``src.services.mix_discord_projector``) re-renders this card into that same
message. It is built from current state every time rather than once at post
time.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from shared.division_grid import DEFAULT_GRID
from shared.domain.discord_ui import BLUE, ROLE_EMOJI, SHORTCODE, TEAL, division_emoji, emoji
from shared.domain.mix_lobby import LOBBY_LETTERS
from shared.schemas.events import DiscordActionButton, DiscordCard, DiscordLinkButton
from src.domain.balancer.result_serializer import seat_rating
from src.domain.mix_lineup_image import LineupPicture, LineupSeat, LineupTeam
from src.services.balancer.role_naming import role_slot_code

__all__ = ("SignupPlayer", "lineup_card", "lineup_picture", "signup_card")

#: Mix statuses nobody can sign up for any more.
_TERMINAL = {"completed": "завершён", "cancelled": "отменён"}
#: The roles a signup counter breaks down by: the three role codes, then full flex.
_COUNTED_ROLES = ("tank", "damage", "support", "flex")
#: Room the player lists may take, measured as Discord counts it: AFTER the bot
#: swaps every ``:owt_*:`` shortcode for ``<:owt_name:id>``, which the card's
#: own length check cannot see. Leaves the rest of the card its headroom.
_LISTS_BUDGET = 3000
#: What the bot's swap adds to one shortcode: ``<`` + a snowflake id + ``>``.
_SHORTCODE_GROWTH = 21


@dataclass(frozen=True, slots=True)
class SignupPlayer:
    """One roster row as the signup card shows it, in roster order.

    ``role`` is the role the row comes for: ``"flex"`` for a Full Flex row,
    otherwise its preferred role -- the first explicit one, or the best ranked
    one for "every role I have a rank for" -- and ``None`` when it has none.
    ``name`` is the one the balancer shows for the row, and ``rank`` the number
    it balances them at on their preferred role.
    """

    name: str
    role: str | None
    benched: bool = False
    rank: int | None = None


#: Everything Discord markdown gives a meaning to; a backslash before ASCII
#: punctuation is always consumed, so over-escaping is invisible to the reader.
#: Same rule app-service renders notification cards with.
_MARKDOWN = re.compile(r"([\\*_~`|>\[\]<#-])")


def _escape(text: str) -> str:
    return _MARKDOWN.sub(r"\\\1", text)


def _board_button(board_url: str) -> DiscordLinkButton:
    return DiscordLinkButton(label="Доска микса", url=board_url, emoji="link")


def _timestamp(moment: datetime) -> str:
    """Discord's own relative clock, so "2 minutes ago" is rendered per reader."""
    return f"<t:{int(moment.timestamp())}:R>"


def _signup_counts(players: Sequence[SignupPlayer]) -> dict[str, int]:
    """How many rows come for each role; a row with no role is in no counter."""
    counts = dict.fromkeys(_COUNTED_ROLES, 0)
    for player in players:
        if player.role in counts:
            counts[player.role] += 1
    return counts


def _rendered_len(text: str) -> int:
    """``text``'s length once the bot has expanded its emoji shortcodes."""
    return len(text) + _SHORTCODE_GROWTH * len(SHORTCODE.findall(text))


def _player_line(player: SignupPlayer) -> str:
    """``:role: :badge: Name · 2450``: the role they come for, and how good they are at it.

    The badge is the Overwatch rank the number lands in (the seat panel's own
    badges) and simply disappears until it is uploaded; the number stays.
    """
    role = emoji(ROLE_EMOJI[player.role]) if player.role in ROLE_EMOJI else ""
    if player.rank is None:
        return " ".join(part for part in (role, _escape(player.name)) if part) + " · без ранга"
    badge = division_emoji(DEFAULT_GRID.resolve_division(player.rank).slug)
    return " ".join(part for part in (role, badge, _escape(player.name)) if part) + f" · {player.rank}"


def _player_lists(players: Sequence[SignupPlayer]) -> list[str]:
    """The pool, then the bench, one player a line, cut at the budget with the rest counted."""
    sections = [
        ("**Игроки**", [player for player in players if not player.benched]),
        (f"{emoji('bench')} **Скамейка**", [player for player in players if player.benched]),
    ]
    lines: list[str] = []
    used = 0
    for heading, members in sections:
        if not members:
            continue
        lines.append(heading)
        used += _rendered_len(heading) + 1
        for index, player in enumerate(members):
            line = _player_line(player)
            if used + _rendered_len(line) + 1 > _LISTS_BUDGET:
                lines.append(f"-# и ещё {len(members) - index}")
                break
            lines.append(line)
            used += _rendered_len(line) + 1
    return lines


def signup_card(
    *,
    mix_name: str,
    host_name: str | None,
    board_url: str,
    custom_game_id: int,
    self_signup: str,
    status: str,
    lobby_count: int,
    players: Sequence[SignupPlayer],
    updated_at: datetime,
) -> DiscordCard:
    """The live channel post that opens a mix for self-signup.

    Three states, because a reader has to see the difference from across the
    room: open (green dot, every button live), closed by the host (lock, Join
    greyed out -- the card stays readable, and whoever is already in can still
    check their seat or leave), and over (lock, no buttons at all; a finished
    mix answers nothing).

    ``players`` is the whole roster in balancer order: the counters say how the
    lobby is shaping up, the lists say who is in it with the role and rank they
    come with -- the pool (must-play included) and the bench apart, as the
    balancer splits them.
    """
    name = _escape(mix_name)
    terminal = _TERMINAL.get(str(status))
    closed = self_signup == "closed"
    if terminal is not None:
        headline = f"## {emoji('lock')} Микс «{name}» {terminal}"
    elif closed:
        headline = f"## {emoji('lock')} Запись на микс «{name}» закрыта"
    else:
        headline = f"## {emoji('live')} Запись на микс «{name}»"

    facts = [f"{emoji('host')} {_escape(host_name) if host_name else '—'}"]
    if lobby_count > 1:
        marks = "".join(emoji(f"lobby_{LOBBY_LETTERS[index].lower()}") for index in range(lobby_count))
        facts.append(f"{marks} {lobby_count} лобби")
    if terminal is None and self_signup == "pool":
        facts.append(f"{emoji('pool')} сразу в пул")
    elif terminal is None and self_signup == "benched":
        facts.append(f"{emoji('bench')} сначала на скамейку")

    counts = _signup_counts(players)
    details = [
        f"{emoji('players')} **{len(players)}** записано"
        f" · {emoji('tank')} {counts['tank']}"
        f" · {emoji('damage')} {counts['damage']}"
        f" · {emoji('support')} {counts['support']}"
        f" · {emoji('flex')} {counts['flex']}"
    ]
    details.extend(_player_lists(players))
    if terminal is None and not closed:
        details.append("1. Нажмите «Записаться»  2. Настройте роли в ответе бота")
        details.append(f"-# Нужны привязанные Discord и Battle.net · обновлено {_timestamp(updated_at)}")
    else:
        details.append(f"-# обновлено {_timestamp(updated_at)}")

    target = str(custom_game_id)
    answers: list[DiscordActionButton] = (
        []
        if terminal is not None
        else [
            DiscordActionButton(
                label="Записаться", action="mix.join", target=target, style="success", emoji="join", disabled=closed
            ),
            DiscordActionButton(label="Моё место", action="mix.roles", target=target, emoji="edit"),
            DiscordActionButton(label="Выписаться", action="mix.leave", target=target, style="danger", emoji="leave"),
        ]
    )
    return DiscordCard(
        accent_color=BLUE if terminal is not None else TEAL,
        text="\n".join([headline, " · ".join(facts)]),
        details="\n".join(details),
        answers=answers,
        rows=[[_board_button(board_url)]],
    )


#: Russian names of the Overwatch divisions, by the tier slug's division part.
_DIVISION_NAMES = {
    "bronze": "Бронза",
    "silver": "Серебро",
    "gold": "Золото",
    "platinum": "Платина",
    "emerald": "Изумруд",
    "diamond": "Алмаз",
    "master": "Мастер",
    "grandmaster": "Грандмастер",
    "champion": "Чемпион",
}


def _picture_seat(bucket: str, uuid: str, player: Mapping[str, Any]) -> LineupSeat:
    rating = int(seat_rating(player, bucket))
    tier = DEFAULT_GRID.resolve_division(rating)
    division, _, number = (tier.slug or "").rpartition("-")
    return LineupSeat(
        role=role_slot_code(bucket),
        name=str(player.get("name") or f"#{uuid}"),
        rating=rating,
        division=tier.slug,
        division_name=f"{_DIVISION_NAMES[division]} {number}" if division in _DIVISION_NAMES else tier.name,
        captain=player.get("is_captain") is True,
    )


def _picture_team(name: str, team: Mapping[str, Any], players: Mapping[str, Any]) -> LineupTeam:
    roster = team.get("roster")
    seats = tuple(
        _picture_seat(bucket, str(uuid), players.get(str(uuid)) or {})
        for bucket, uuids in (roster.items() if isinstance(roster, Mapping) else ())
        if isinstance(uuids, list)
        for uuid in uuids
    )
    # The mean of the numbers drawn, so the two averages and their gap are checkable on the picture.
    average = round(sum(seat.rating for seat in seats) / len(seats)) if seats else None
    return LineupTeam(name=name, average=average, seats=seats)


def _map_line(next_map: tuple[str, str | None] | None) -> str | None:
    if next_map is None:
        return None
    map_name, gamemode = next_map
    return f"{map_name} · {gamemode}" if gamemode else map_name


def lineup_picture(
    *,
    mix_name: str,
    match_number: int,
    variant: Mapping[str, Any],
    players: Mapping[str, Any],
    team_names: Mapping[int, str],
    next_map: tuple[str, str | None] | None,
    points_per_win: int | None,
    board_url: str,
    lobby_label: str | None = None,
) -> LineupPicture:
    """What the matchup picture of one lobby shows.

    ``variant`` is one option of a stored ``lobby_document`` and ``players``
    that document's player map, which its seat uuids resolve against. A rank
    badge is the Overwatch division the seat's rating lands in, like the
    signup card's.
    """
    teams = variant.get("teams")
    return LineupPicture(
        kicker=f"Микс · Лобби {lobby_label}" if lobby_label else "Микс",
        title=f"Игра {match_number} · {mix_name}",
        note=f"+{points_per_win} за победу" if points_per_win else None,
        teams=tuple(
            _picture_team(team_names.get(index) or f"Команда {index + 1}", team, players)
            for index, team in enumerate(teams if isinstance(teams, list) else [])
            if isinstance(team, Mapping)
        ),
        map_name=_map_line(next_map),
        footer=board_url.split("://", 1)[-1],
    )


def lineup_card(
    *,
    mix_name: str,
    match_number: int,
    next_map: tuple[str, str | None] | None,
    points_per_win: int | None,
    board_url: str,
    image_filename: str,
    lobby_label: str | None = None,
    mentions: Sequence[str] = (),
    voice_target: str | None = None,
) -> DiscordCard:
    """The matchup one lobby is about to play.

    The picture (``image_filename``, drawn from :func:`lineup_picture`) IS the
    lineup; the text only names the game and the map, so a notification
    preview says which game it is without the picture.

    ``next_map`` is ``(map name, gamemode name)`` or ``None`` when nobody has
    rolled one yet -- posting a lineup before the roll is normal, so that reads
    as "not chosen yet" rather than omitting the line. ``lobby_label`` names the
    lobby when the mix runs two of them: both post into the same channel, and
    "game 3" of one is not "game 3" of the other.

    ``mentions`` are the Discord ids of seated players whose account is linked;
    they ping, which is the point of posting a lineup at all.

    ``voice_target`` is the mix and lobby the voice buttons act on; only the
    lobby's newest card carries them.
    """
    title = " · ".join([_escape(mix_name), *([f"Лобби {lobby_label}"] if lobby_label else []), f"Игра {match_number}"])
    map_line = _map_line(next_map)
    where = f"{emoji('map')} " + (_escape(map_line) if map_line else "Карта ещё не выбрана")
    if points_per_win:
        where += f" · {emoji('points')} +{points_per_win} за победу"

    return DiscordCard(
        accent_color=TEAL,
        text="\n".join([f"## {emoji('vs')} {title}", where]),
        details=f"-# {emoji('players')} " + " ".join(f"<@{discord_id}>" for discord_id in mentions)
        if mentions
        else None,
        image_url=f"attachment://{image_filename}",
        rows=[[_board_button(board_url)]],
        answers=[]
        if voice_target is None
        else [
            DiscordActionButton(label="Развести по войсам", action="voice.move", target=voice_target, style="primary"),
            DiscordActionButton(label="Вернуть в общий", action="voice.return", target=voice_target),
        ],
    )
