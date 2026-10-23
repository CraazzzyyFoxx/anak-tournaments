"""League of Legends' native ladder: league-v4 ranked tiers, top first (1 = Challenger).

Divisional tiers (Iron..Diamond) x divisions IV..I are 100 wide, Iron IV = 0..99 up to Diamond I = 2700..2799. The apex
tiers have nominal bands (Master 2800, Grandmaster 3100, Challenger 3500 and up, open top like Overwatch's Champion 1)
because their LP is unbounded. ``rank_value`` = divisional floor + min(LP, 99); any apex tier = 2800 + LP. Icons are the
tier emblems served from ``frontend/public/disciplines/lol/ranks/`` (site-relative, as Overwatch's ``/divisions``).
"""

from __future__ import annotations

from shared.disciplines.spec import NativeTier

__all__ = (
    "APEX_TIERS",
    "DIVISIONAL_TIERS",
    "NATIVE_LADDER",
    "QUEUES",
    "division_number",
    "icon_url",
    "rank_value",
)

#: league-v4 ``tier`` wire values below the apex, bottom first.
DIVISIONAL_TIERS: tuple[str, ...] = ("IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND")
#: ``(tier, rank_min, rank_max)`` of the apex tiers, bottom first; Challenger is open-topped.
APEX_TIERS: tuple[tuple[str, int, int | None], ...] = (
    ("MASTER", 2800, 3099),
    ("GRANDMASTER", 3100, 3499),
    ("CHALLENGER", 3500, None),
)
#: league-v4 ``queueType`` -> the snapshot's ``queue``; every other queue is ignored.
QUEUES: dict[str, str] = {"RANKED_SOLO_5x5": "solo", "RANKED_FLEX_SR": "flex"}

_ROMAN = {"IV": 4, "III": 3, "II": 2, "I": 1}
_ROMAN_BY_NUMBER = {number: roman for roman, number in _ROMAN.items()}
_SPAN = 100
_APEX_FLOOR = APEX_TIERS[0][1]
_APEX_NAMES = frozenset(name for name, _, _ in APEX_TIERS)


def division_number(rank: str | None) -> int | None:
    """league-v4 ``rank`` (``"IV"``..``"I"``) -> 4..1."""
    return _ROMAN.get((rank or "").upper())


def _floor(tier: str, number: int) -> int:
    return (DIVISIONAL_TIERS.index(tier) * 4 + (4 - number)) * _SPAN


def rank_value(tier: str, rank: str | None, lp: int) -> int | None:
    tier = tier.upper()
    if tier in _APEX_NAMES:
        return _APEX_FLOOR + max(lp, 0)
    number = division_number(rank)
    if tier not in DIVISIONAL_TIERS or number is None:
        return None
    return _floor(tier, number) + min(max(lp, 0), _SPAN - 1)


def icon_url(tier: str) -> str:
    return f"/disciplines/lol/ranks/{tier.lower()}.png"


def _ladder() -> tuple[NativeTier, ...]:
    rows: list[tuple[str, int | None, int, int | None]] = [
        (name, None, low, high) for name, low, high in reversed(APEX_TIERS)
    ]
    for tier in reversed(DIVISIONAL_TIERS):
        rows += [(tier, number, _floor(tier, number), _floor(tier, number) + _SPAN - 1) for number in (1, 2, 3, 4)]
    return tuple(
        NativeTier(
            number=position,
            slug=tier.lower() if number is None else f"{tier.lower()}-{number}",
            name=tier.capitalize() if number is None else f"{tier.capitalize()} {_ROMAN_BY_NUMBER[number]}",
            rank_min=low,
            rank_max=high,
            icon_url=icon_url(tier),
            native_division=tier,
            native_tier=number,
        )
        for position, (tier, number, low, high) in enumerate(rows, start=1)
    )


NATIVE_LADDER: tuple[NativeTier, ...] = _ladder()
