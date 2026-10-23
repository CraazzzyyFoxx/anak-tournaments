"""Canonical OW division normalization. No session."""

from __future__ import annotations

import pandas as pd

from shared.division_grid import DEFAULT_GRID, DivisionGrid, canonical_division_number

__all__ = (
    "canonical_div_for",
    "assign_canonical_division",
)


def _grid_for(grids: dict[int, DivisionGrid], version_id: int | float | None) -> DivisionGrid:
    if version_id is None or pd.isna(version_id):
        return DEFAULT_GRID
    return grids.get(int(version_id), DEFAULT_GRID)


def canonical_div_for(
    grids: dict[int, DivisionGrid],
    version_id: int | float | None,
    rank: int | float | None,
) -> int | None:
    """Canonical division for ``rank`` recorded under ``version_id``.

    ``None``/unknown ``version_id`` falls back to the canonical grid (the rank is
    then treated as already on the OW SR scale). An unranked row (``None``/NaN
    ``rank``) has no division: ``None``.
    """
    if pd.isna(rank):
        return None
    return canonical_division_number(_grid_for(grids, version_id), int(rank), DEFAULT_GRID)


def assign_canonical_division(
    df: pd.DataFrame,
    grids: dict[int, DivisionGrid],
    *,
    rank_col: str,
    version_col: str = "version_id",
    out_col: str = "div",
) -> pd.DataFrame:
    """Assign ``out_col`` = canonical division per row of ``df`` in place."""
    if df.empty:
        df[out_col] = pd.Series(dtype="int64")
        return df
    df[out_col] = [
        canonical_div_for(grids, version_id, rank)
        for version_id, rank in zip(df[version_col], df[rank_col], strict=False)
    ]
    return df
