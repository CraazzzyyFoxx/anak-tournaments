"""Ordered (source_item_id, position) pairs for wiring a playoff from groups."""

from __future__ import annotations

__all__ = ("build_seeding",)


def build_seeding(
    source_items: list,
    top: int,
    mode: str,
    position_offset: int = 0,
) -> list[tuple[int, int]]:
    """Build ordered (source_item_id, position) pairs for seeding.

    ``position_offset`` shifts which positions are selected — used to pick
    LB positions that follow UB ones (e.g. offset=2 yields positions 3, 4, ...).
    """
    seeding: list[tuple[int, int]] = []
    if mode == "snake":
        for col in range(top):
            position = position_offset + col + 1
            for item in source_items:
                seeding.append((item.id, position))
    else:  # "cross" — default
        for col in range(top):
            position = position_offset + col + 1
            # Flip every odd column so group A's 1st doesn't meet A's 2nd.
            ordered = list(source_items) if col % 2 == 0 else list(reversed(source_items))
            for item in ordered:
                seeding.append((item.id, position))
    return seeding
