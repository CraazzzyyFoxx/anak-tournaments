"""Shared ``DivisionGrid``/``DivisionTier`` test-double builders.

``shared.division_grid.DivisionGrid``/``DivisionTier`` is a cross-service
domain type -- division-grid resolution runs in both app-service and
tournament-service. Every suite that needed a grid for a test used to
hand-roll its own tier/grid builder, all constructing the same dataclass
fields (``id``, ``slug``, ``number``, ``name``, ``rank_min``, ``rank_max``,
``icon_url``) with the same "derive slug/name from the division number,
empty icon" defaults. Centralized here so the mapping onto the real
dataclasses only needs to match once.
"""

from __future__ import annotations

from typing import Any

from shared.division_grid import DivisionGrid, DivisionTier

#: Sentinel distinguishing "not passed" (derive from ``number``) from an
#: explicit ``slug=None``/``name=None`` override.
_UNSET: Any = object()


def division_tier(
    tier_id: int,
    number: int,
    rank_min: int,
    rank_max: int | None,
    *,
    slug: str | None | Any = _UNSET,
    name: str | None | Any = _UNSET,
    icon_url: str = "",
) -> DivisionTier:
    """A ``DivisionTier`` with ``slug``/``name`` auto-derived from ``number``.

    Pass ``slug``/``name`` explicitly (including ``None``) to override the
    derived default -- some suites need ``slug=None`` or a non-numeric name.
    """
    return DivisionTier(
        id=tier_id,
        slug=f"division-{number}" if slug is _UNSET else slug,
        number=number,
        name=f"Division {number}" if name is _UNSET else name,
        rank_min=rank_min,
        rank_max=rank_max,
        icon_url=icon_url,
    )


def division_grid(version_id: int, tiers: tuple[tuple[int, int, int, int | None], ...]) -> DivisionGrid:
    """Build a ``DivisionGrid`` from ``(tier_id, number, rank_min, rank_max)`` tuples."""
    return DivisionGrid(
        version_id=version_id,
        tiers=tuple(
            division_tier(tier_id, number, rank_min, rank_max) for tier_id, number, rank_min, rank_max in tiers
        ),
    )
