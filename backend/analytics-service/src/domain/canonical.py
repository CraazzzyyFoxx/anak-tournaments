"""Canonical OW division normalization. No session."""

from __future__ import annotations

import pandas as pd

from shared.division_grid import DEFAULT_GRID, DivisionGrid

__all__ = (
    "canonical_division_number",
    "canonical_div_for",
    "assign_canonical_division",
)


def canonical_division_number(source_grid: DivisionGrid, rank: int) -> int:
    """Map ``rank`` on ``source_grid`` to a division number on ``DEFAULT_GRID``."""
    tier = source_grid.resolve_division(int(rank))

    if tier.ow_rank_min is not None and tier.ow_rank_max is not None:
        low = min(int(tier.ow_rank_min), int(tier.ow_rank_max))
        high = max(int(tier.ow_rank_min), int(tier.ow_rank_max))
        return DEFAULT_GRID.resolve_division((low + high) // 2).number

    n_min, n_max = source_grid.min_division, source_grid.max_division
    m_min, m_max = DEFAULT_GRID.min_division, DEFAULT_GRID.max_division
    if n_max <= n_min:
        return m_min
    frac = (tier.number - n_min) / (n_max - n_min)
    return int(round(m_min + frac * (m_max - m_min)))


def _grid_for(grids: dict[int, DivisionGrid], version_id: int | float | None) -> DivisionGrid:
    if version_id is None or pd.isna(version_id):
        return DEFAULT_GRID
    return grids.get(int(version_id), DEFAULT_GRID)


def canonical_div_for(
    grids: dict[int, DivisionGrid],
    version_id: int | float | None,
    rank: int,
) -> int:
    """Canonical division for ``rank`` recorded under ``version_id``.

    ``None``/unknown ``version_id`` falls back to the canonical grid (the rank is
    then treated as already on the OW SR scale).
    """
    return canonical_division_number(_grid_for(grids, version_id), int(rank))


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
