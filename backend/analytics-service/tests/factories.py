"""Shared test doubles for analytics-service's ML mechanics tests.

``identity_assign`` used to be hand-rolled identically in two suites; kept
here so the "canonical division == the supplied rank" stub contract is
defined once.
"""

from __future__ import annotations

import pandas as pd


def identity_assign(
    df: pd.DataFrame,
    grids: object,
    *,
    rank_col: str,
    version_col: str = "version_id",
    out_col: str = "div",
) -> pd.DataFrame:
    """Stub: canonical division == the supplied rank (1:1), for mechanics tests."""
    df[out_col] = df[rank_col].astype(int)
    return df
