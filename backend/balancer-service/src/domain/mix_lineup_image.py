"""The matchup picture a lineup card shows: a 1200x630 PNG drawn here, from the stored lineup.

``mix_discord.lineup_picture`` decides what the picture says (names, ranks,
the map); this module only lays it out. It used to be a screenshot the host's
browser took of the mix page, which meant no card refresh without that tab open.
Drawn server-side from the committed lineup, the picture always matches the
text of its card, and the projector can redraw it from any change event.

The assets are copies in ``assets/lineup`` (Onest, the rank badges of the
repo's ``static/divisions``, the bot's role emoji), so drawing needs no network.

``LineupPicture.filename`` hashes everything drawn: a card whose picture would
come out the same names the same file, so the projector can tell an unchanged
card from a changed one without drawing anything.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

__all__ = ("LineupPicture", "LineupSeat", "LineupTeam", "render_png")

_ASSETS = Path(__file__).resolve().parents[2] / "assets" / "lineup"

WIDTH, HEIGHT = 1200, 630
_MARGIN = 60
_GAP = 24

# The site's dark theme, by hand: the same literal palette the frontend's
# OpenGraph cards mirror (``frontend/src/lib/og/encounter.tsx``).
_BG_FROM, _BG_TO = (11, 17, 32), (17, 26, 46)
_PANEL, _BORDER = (19, 28, 48), (31, 43, 69)
_FG, _MUTED, _FAINT = (232, 238, 247), (138, 160, 189), (107, 127, 156)
_TEAL = (45, 212, 191)
#: Team accents: home teal, away rose -- the board's own two sides.
_SIDES = ((45, 212, 191), (251, 113, 133))


@dataclass(frozen=True, slots=True)
class LineupSeat:
    #: ``tank``/``damage``/``support``; anything else draws no role glyph.
    role: str
    name: str
    rating: int
    #: Tier slug (``gold-3``) of the badge, ``None`` for none.
    division: str | None
    #: What the badge is called, in the card's language.
    division_name: str
    captain: bool = False


@dataclass(frozen=True, slots=True)
class LineupTeam:
    name: str
    average: int | None
    seats: tuple[LineupSeat, ...]


@dataclass(frozen=True, slots=True)
class LineupPicture:
    kicker: str
    title: str
    #: Top-right accent line (``+25 за победу``), ``None`` for none.
    note: str | None
    teams: tuple[LineupTeam, ...]
    #: ``Busan · Контроль``, ``None`` before anyone rolled a map.
    map_name: str | None
    footer: str

    @property
    def filename(self) -> str:
        """``lineup-<digest>.png``: the same picture, the same name."""
        digest = hashlib.sha1(repr(self).encode(), usedforsecurity=False).hexdigest()[:12]
        return f"lineup-{digest}.png"


@cache
def _font(weight: int, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_ASSETS / f"onest-{weight}.ttf"), size)


@cache
def _icon(relative: str, size: int) -> Image.Image | None:
    path = _ASSETS / relative
    if not path.is_file():
        return None
    with Image.open(path) as source:
        return source.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)


def _fit(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: float) -> str:
    """``text``, cut with an ellipsis until it fits ``width``."""
    if draw.textlength(text, font=font) <= width:
        return text
    while text and draw.textlength(text + "…", font=font) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _background() -> Image.Image:
    """The site's dark gradient, top to bottom."""
    ramp = Image.linear_gradient("L").resize((WIDTH, HEIGHT))
    return Image.composite(Image.new("RGB", (WIDTH, HEIGHT), _BG_TO), Image.new("RGB", (WIDTH, HEIGHT), _BG_FROM), ramp)


def _team(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    team: LineupTeam,
    box: tuple[int, int, int, int],
    accent: tuple[int, int, int],
    rows: int,
) -> None:
    left, top, right, bottom = box
    width = right - left
    draw.rounded_rectangle(box, radius=12, fill=_PANEL, outline=_BORDER)
    draw.rectangle((left + 12, top, right - 12, top + 3), fill=accent)

    head = _font(700, 18)
    average = f"ср. {team.average}" if team.average is not None else ""
    draw.text((right - 22, top + 30), average, font=head, fill=_MUTED, anchor="rm")
    room = width - 44 - draw.textlength(average, font=head) - 16
    draw.text((left + 22, top + 30), _fit(draw, team.name.upper(), head, room), font=head, fill=accent, anchor="lm")

    name_font, rank_font, rating_font, tag_font = _font(700, 22), _font(400, 17), _font(400, 16), _font(700, 11)
    step = min(52, (bottom - top - 66) // max(rows, 1))
    rank_x = left + width // 2
    name_width = rank_x - 12 - (left + 58)
    for index, seat in enumerate(team.seats):
        middle = top + 60 + step * index + step // 2
        glyph = _icon(f"roles/{seat.role}.png", 24)
        if glyph is not None:
            image.alpha_composite(glyph, (left + 22, middle - 12))
        name_y = middle - 6 if seat.captain else middle
        draw.text(
            (left + 58, name_y), _fit(draw, seat.name, name_font, name_width), font=name_font, fill=_FG, anchor="lm"
        )
        if seat.captain:
            draw.text((left + 58, middle + 14), "КАПИТАН", font=tag_font, fill=_FAINT, anchor="lm")

        badge = _icon(f"divisions/{seat.division}.png", 30) if seat.division else None
        if badge is not None:
            image.alpha_composite(badge, (rank_x, middle - 15))
        rating = str(seat.rating)
        draw.text((right - 22, middle), rating, font=rating_font, fill=_FAINT, anchor="rm")
        rank_room = right - 22 - draw.textlength(rating, font=rating_font) - 12 - (rank_x + 40)
        draw.text(
            (rank_x + 40, middle),
            _fit(draw, seat.division_name, rank_font, rank_room),
            font=rank_font,
            fill=_MUTED,
            anchor="lm",
        )


def render_png(picture: LineupPicture) -> bytes:
    """``picture`` drawn as a PNG."""
    image = _background().convert("RGBA")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 5), fill=_TEAL)

    draw.text((_MARGIN, 52), picture.kicker.upper(), font=_font(700, 16), fill=_FAINT, anchor="lm")
    title_font = _font(700, 44)
    title_room = WIDTH - 2 * _MARGIN
    if picture.note:
        note_font = _font(700, 20)
        draw.text((WIDTH - _MARGIN, 96), picture.note, font=note_font, fill=_TEAL, anchor="rm")
        title_room -= int(draw.textlength(picture.note, font=note_font)) + 32
    draw.text((_MARGIN, 96), _fit(draw, picture.title, title_font, title_room), font=title_font, fill=_FG, anchor="lm")

    teams = picture.teams or (LineupTeam(name="—", average=None, seats=()),)
    column = (WIDTH - 2 * _MARGIN - _GAP * (len(teams) - 1)) // len(teams)
    rows = max(len(team.seats) for team in teams)
    for index, team in enumerate(teams):
        left = _MARGIN + index * (column + _GAP)
        _team(image, draw, team, (left, 150, left + column, 482), _SIDES[index % len(_SIDES)], rows)

    draw.text((_MARGIN, 508), "КАРТА", font=_font(700, 13), fill=_FAINT, anchor="lm")
    draw.text(
        (_MARGIN, 536),
        _fit(draw, picture.map_name or "Ещё не выбрана", _font(700, 22), WIDTH * 0.6),
        font=_font(700, 22),
        fill=_FG if picture.map_name else _MUTED,
        anchor="lm",
    )
    averages = [team.average for team in teams if team.average is not None]
    if len(averages) == 2:
        draw.text((WIDTH - _MARGIN, 508), "РАЗНИЦА СРЕДНИХ", font=_font(700, 13), fill=_FAINT, anchor="rm")
        draw.text(
            (WIDTH - _MARGIN, 536), str(abs(averages[0] - averages[1])), font=_font(700, 22), fill=_FG, anchor="rm"
        )

    draw.line((_MARGIN, 568, WIDTH - _MARGIN, 568), fill=_BORDER, width=1)
    draw.text(
        (_MARGIN, 592),
        _fit(draw, picture.footer, _font(400, 15), WIDTH - 2 * _MARGIN),
        font=_font(400, 15),
        fill=_FAINT,
        anchor="lm",
    )

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, "PNG", optimize=True)
    return buffer.getvalue()
