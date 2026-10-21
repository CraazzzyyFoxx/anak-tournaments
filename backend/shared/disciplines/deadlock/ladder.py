"""Deadlock's native ladder: 11 ranked tiers x 6 subranks, deadlock-api ``badge = tier * 10 + subrank``.

``rank_value = ((tier - 1) * 6 + subrank) * 100``: Initiate 1 = 100 up to Eternus 6 = 6600, each subrank 100 wide and
Eternus 6 open-topped. Tier 0 (Obscurus, badge 0) is unranked and has no value. Icons are the tier emblems served from
``frontend/public/disciplines/deadlock/ranks/`` (site-relative, as LoL's); the subrank is shown as text.
"""

from __future__ import annotations

from shared.disciplines.spec import NativeTier

__all__ = ("NATIVE_LADDER", "SUBRANKS", "TIER_NAMES", "icon_url", "rank_value", "rank_value_from_badge")

#: deadlock-api ``/v1/assets/ranks`` names by tier number; 0 is the unranked Obscurus.
TIER_NAMES: tuple[str, ...] = (
    "Obscurus",
    "Initiate",
    "Seeker",
    "Acolyte",
    "Sentinel",
    "Mystic",
    "Ritualist",
    "Emissary",
    "Oracle",
    "Phantom",
    "Ascendant",
    "Eternus",
)
SUBRANKS = 6
_SPAN = 100


def rank_value(tier: int, subrank: int) -> int | None:
    if not 1 <= tier < len(TIER_NAMES) or not 1 <= subrank <= SUBRANKS:
        return None
    return ((tier - 1) * SUBRANKS + subrank) * _SPAN


def rank_value_from_badge(badge: int) -> int | None:
    return rank_value(*divmod(badge, 10))


def icon_url(tier: int) -> str:
    return f"/disciplines/deadlock/ranks/{TIER_NAMES[tier].lower()}.png"


def _ladder() -> tuple[NativeTier, ...]:
    steps = [(tier, subrank) for tier in range(len(TIER_NAMES) - 1, 0, -1) for subrank in range(SUBRANKS, 0, -1)]
    tiers = []
    for number, (tier, subrank) in enumerate(steps, start=1):
        name, value = TIER_NAMES[tier], ((tier - 1) * SUBRANKS + subrank) * _SPAN
        tiers.append(
            NativeTier(
                number=number,
                slug=f"{name.lower()}-{subrank}",
                name=f"{name} {subrank}",
                rank_min=value,
                rank_max=None if number == 1 else value + _SPAN - 1,
                icon_url=icon_url(tier),
                native_division=name,
                native_tier=subrank,
            )
        )
    return tuple(tiers)


NATIVE_LADDER: tuple[NativeTier, ...] = _ladder()
