"""VALORANT's native ladder: 8 ranked tiers x 3 divisions, then Radiant -- 25 tiers, listed top first.

``rank_value = ((tier - 1) * 3 + division) * 100``: Iron 1 = 100..199 up to Immortal 3 = 2400..2499, Radiant = 2500 and
up (open top). No collector reads ranks (VALORANT's API gives no per-player rank without RSO), so organizers enter
them; the ladder seeds new grids. Icons are the per-division emblems served from
``frontend/public/disciplines/valorant/ranks/`` (site-relative, as LoL's).
"""

from __future__ import annotations

from shared.disciplines.spec import NativeTier

__all__ = ("NATIVE_LADDER",)

#: valorant-api ``competitivetiers`` division names below Radiant, bottom first.
TIERS: tuple[str, ...] = ("Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal")
DIVISIONS = 3
_SPAN = 100
_RADIANT = (len(TIERS) * DIVISIONS + 1) * _SPAN


def _ladder() -> tuple[NativeTier, ...]:
    tiers = [
        NativeTier(
            number=1,
            slug="radiant",
            name="Radiant",
            rank_min=_RADIANT,
            rank_max=None,
            icon_url="/disciplines/valorant/ranks/radiant.png",
            native_division="Radiant",
            native_tier=None,
        )
    ]
    steps = [(tier, division) for tier in range(len(TIERS), 0, -1) for division in range(DIVISIONS, 0, -1)]
    for number, (tier, division) in enumerate(steps, start=2):
        name, value = TIERS[tier - 1], ((tier - 1) * DIVISIONS + division) * _SPAN
        slug = f"{name.lower()}-{division}"
        tiers.append(
            NativeTier(
                number=number,
                slug=slug,
                name=f"{name} {division}",
                rank_min=value,
                rank_max=value + _SPAN - 1,
                icon_url=f"/disciplines/valorant/ranks/{slug}.png",
                native_division=name,
                native_tier=division,
            )
        )
    return tuple(tiers)


NATIVE_LADDER: tuple[NativeTier, ...] = _ladder()
