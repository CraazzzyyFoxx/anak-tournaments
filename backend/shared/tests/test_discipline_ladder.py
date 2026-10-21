"""Native ladder boundaries and discipline-local fallback (D87)."""

from __future__ import annotations

import pytest

from shared.disciplines import DISCIPLINES, DisciplineSpec, NativeTier
from shared.division_grid import ladder_grid


@pytest.mark.parametrize(
    ("rank", "slug"),
    [
        (499, "bronze-5"),
        (500, "bronze-5"),
        (599, "bronze-5"),
        (600, "bronze-4"),
        (1499, "silver-1"),
        (1500, "gold-5"),
        (2499, "platinum-1"),
        (2500, "emerald-5"),
        (4899, "champion-2"),
        (4900, "champion-1"),
        (10000, "champion-1"),
    ],
)
def test_overwatch_native_rank_boundaries(rank: int, slug: str) -> None:
    grid = ladder_grid("overwatch")
    assert grid is not None
    tier = grid.resolve_division_from_native_rank(rank)
    assert tier is not None and tier.slug == slug


@pytest.mark.parametrize("code", ["unregistered-game"])
def test_a_discipline_without_a_ladder_does_not_inherit_overwatch(code: str) -> None:
    assert ladder_grid(code) is None


def test_another_disciplines_native_scale_is_not_interpreted_as_overwatch(monkeypatch) -> None:
    monkeypatch.setitem(
        DISCIPLINES,
        "test-ladder",
        DisciplineSpec(
            "test-ladder",
            "Test ladder",
            native_ladder=(
                NativeTier(1, "top", "Top", 20, None, "/top.png", "top", 1),
                NativeTier(2, "base", "Base", 10, 19, "/base.png", "base", 1),
            ),
        ),
    )
    try:
        grid = ladder_grid("test-ladder")
        assert grid is not None
        for rank, expected in ((9, "base"), (10, "base"), (19, "base"), (20, "top"), (500, "top")):
            tier = grid.resolve_division_from_native_rank(rank)
            assert tier is not None and tier.slug == expected
    finally:
        ladder_grid.cache_clear()
