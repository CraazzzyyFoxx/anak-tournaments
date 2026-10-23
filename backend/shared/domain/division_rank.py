from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, overload


class DivisionTierLike(Protocol):
    number: int
    rank_min: int
    rank_max: int | None


class DivisionGridLike(Protocol):
    tiers: Sequence[DivisionTierLike]


@overload
def resolve_tier_for_rank(grid: DivisionGridLike, rank: int) -> DivisionTierLike: ...
@overload
def resolve_tier_for_rank(grid: DivisionGridLike, rank: int | None) -> DivisionTierLike | None: ...
def resolve_tier_for_rank(grid: DivisionGridLike, rank: int | None) -> DivisionTierLike | None:
    """The tier holding ``rank``; ranks below every band land on the floor tier. No rank (NULL) has no tier."""
    if rank is None:
        return None
    if not grid.tiers:
        raise ValueError("Division grid must contain at least one tier")

    for tier in grid.tiers:
        if tier.rank_max is None and rank >= tier.rank_min:
            return tier
        if tier.rank_max is not None and tier.rank_min <= rank <= tier.rank_max:
            return tier

    return grid.tiers[-1]


@overload
def resolve_division_for_rank(grid: DivisionGridLike, rank: int) -> int: ...
@overload
def resolve_division_for_rank(grid: DivisionGridLike, rank: int | None) -> int | None: ...
def resolve_division_for_rank(grid: DivisionGridLike, rank: int | None) -> int | None:
    tier = resolve_tier_for_rank(grid, rank)
    return None if tier is None else tier.number


def resolve_rank_for_division(grid: DivisionGridLike, division_number: int) -> int | None:
    """The ``rank_value`` that represents ``division_number`` — its tier floor.

    A division is a band, so any point inside it identifies the same tier; the floor
    (``rank_min``) is the one every other division->rank path uses (the grid
    normalizer, the OW mapping, the UI rank slider). A band midpoint would give
    off-grid values like 4449 for Grandmaster 1 (4400..4499).
    """
    for tier in grid.tiers:
        if tier.number == division_number:
            return tier.rank_min
    return None
