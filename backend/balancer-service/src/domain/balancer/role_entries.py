from __future__ import annotations

from shared.division_grid import DEFAULT_GRID, DivisionGrid
from shared.services.division_grid.resolution import resolve_tournament_division


def resolve_rank_from_division(
    division_number: int | None,
    grid: DivisionGrid = DEFAULT_GRID,
) -> int | None:
    if division_number is None:
        return None
    return grid.resolve_rank_from_division(division_number)


def resolve_division_from_rank(
    rank_value: int | None,
    grid: DivisionGrid = DEFAULT_GRID,
) -> int | None:
    if rank_value is None:
        return None
    return resolve_tournament_division(rank_value, tournament_grid=grid)


