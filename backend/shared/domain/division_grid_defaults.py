"""A workspace's own per-game default division grid: the pure rules its provisioning and its backfill share.

Every enabled game with a native ladder gets the workspace's own grid, whose v1 is that ladder as-is (one division per
ladder rank), published. :func:`default_grid_plan` decides whether that v1 also becomes the game's explicit default.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any

from shared.disciplines import discipline

__all__ = ("TIER_FIELDS", "default_grid_plan", "default_version_label", "native_ladder_tiers", "unique_slug")

#: The columns a grid tier carries besides its identity and its version.
TIER_FIELDS: tuple[str, ...] = (
    "slug",
    "number",
    "name",
    "sort_order",
    "rank_min",
    "rank_max",
    "icon_url",
    "native_rank_min",
    "native_rank_max",
)


def default_grid_plan(
    *,
    has_ladder: bool,
    has_own_grid: bool,
    has_explicit_default: bool,
    has_system_grid: bool,
    has_tournaments: bool,
    fresh: bool,
) -> tuple[bool, bool]:
    """``(create, activate)`` for one enabled game of one workspace.

    A game without a native ladder, or one the workspace already has a grid of (archived included), gets nothing. Any
    other gets its v1, activated unless that would override an explicit default or move the game off a system grid in
    force. Without a system grid the game resolves through its native ladder, which v1 is, so activating renumbers
    nothing. Off a system grid moves only a game that has just arrived (``fresh``: a new workspace, a game just
    enabled) with nothing played on it; a game already running on it keeps it until an admin activates another.
    """
    create = has_ladder and not has_own_grid
    keeps_system = has_system_grid and (has_tournaments or not fresh)
    return create, create and not has_explicit_default and not keeps_system


def unique_slug(base: str, taken: Collection[str]) -> str:
    """``base``, else the first free of ``base-2``, ``base-3``…"""
    slug, index = base, 1
    while slug in taken:
        index += 1
        slug = f"{base}-{index}"
    return slug


def default_version_label(code: str) -> str:
    return f"Default {discipline(code).name} grid"


def native_ladder_tiers(code: str) -> list[dict[str, Any]]:
    """The game's native ladder as grid tier rows (:data:`TIER_FIELDS`), top first; ``[]`` for a game without one."""
    return [
        {
            "slug": tier.slug,
            "number": tier.number,
            "name": tier.name,
            "sort_order": index,
            "rank_min": tier.rank_min,
            "rank_max": tier.rank_max,
            "icon_url": tier.icon_url,
            "native_rank_min": None,
            "native_rank_max": None,
        }
        for index, tier in enumerate(discipline(code).native_ladder)
    ]
