from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class DivisionTierLike(Protocol):
    number: int
    rank_min: int
    rank_max: int | None


class DivisionGridLike(Protocol):
    tiers: Sequence[DivisionTierLike]


def resolve_tier_for_rank(grid: DivisionGridLike, rank: int) -> DivisionTierLike:
    if not grid.tiers:
        raise ValueError("Division grid must contain at least one tier")

    for tier in grid.tiers:
        if tier.rank_max is None and rank >= tier.rank_min:
            return tier
        if tier.rank_max is not None and tier.rank_min <= rank <= tier.rank_max:
            return tier

    return grid.tiers[-1]


def resolve_division_for_rank(grid: DivisionGridLike, rank: int) -> int:
    return resolve_tier_for_rank(grid, rank).number


def resolve_rank_for_division(grid: DivisionGridLike, division_number: int) -> int | None:
    """The ``rank_value`` that represents ``division_number`` — its tier floor.

    A division is a band, so any point inside it identifies the same tier; the floor
    (``rank_min``) is the one every other division->rank path already uses (the grid
    normalizer, the OW mapping, the UI rank slider). Returning a band midpoint instead
    produced off-grid values like 4449 for Grandmaster 1 (4400..4499).
    """
    for tier in grid.tiers:
        if tier.number == division_number:
            return tier.rank_min
    return None


def clamp_division_to_grid(grid: DivisionGridLike, division_number: int) -> int:
    if not grid.tiers:
        raise ValueError("Division grid must contain at least one tier")

    min_division = min(tier.number for tier in grid.tiers)
    max_division = max(tier.number for tier in grid.tiers)
    return min(max(division_number, min_division), max_division)
