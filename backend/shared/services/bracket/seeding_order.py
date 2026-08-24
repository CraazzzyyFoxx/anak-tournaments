"""Standard 1-vs-N bracket slot order. Shared by SE and DE generators."""

from __future__ import annotations

__all__ = ("seeding_order",)


def seeding_order(size: int) -> list[int]:
    """Generate standard tournament seeding order.

    For size=8 → [0, 7, 3, 4, 1, 6, 2, 5]
    This ensures seed 1 vs seed 8, seed 4 vs seed 5, etc.
    """
    if size == 1:
        return [0]
    half = seeding_order(size // 2)
    result: list[int] = []
    for seed in half:
        result.append(seed)
        result.append(size - 1 - seed)
    return result
