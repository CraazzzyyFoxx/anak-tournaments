"""Pure, DB-free impact-scoring baseline aggregation (spec 2026-07-10).

``build_baseline_rows`` turns a per-(match, user) stat-rate frame into
``StatBaseline`` row dicts. No ``AsyncSession``, ``await``, or ``asyncio`` —
see ``backend/ARCHITECTURE.md``'s "domain/ boundary". Loading the frame from
the DB and atomically replacing a formula version's rows is IO and lives in
``src.services.baselines.service.BaselineService``.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from shared.core.impact import BASELINE_MIN_MINUTES, EVENT_STATS, IMPACT_WEIGHTS, RANK_BUCKETS

__all__ = ("build_baseline_rows",)

_STAT_NAMES = tuple(IMPACT_WEIGHTS)


def build_baseline_rows(stats: pd.DataFrame) -> list[dict]:
    """Aggregate per-(match, user) stat rates into ``StatBaseline`` row dicts.

    ``stats`` columns: ``role`` (str, lowercase), ``rank`` (int), ``minutes``
    (float), ``has_killfeed`` (bool), and ``f"{stat}_rate"`` for every
    ``IMPACT_WEIGHTS`` key. Pure and DB-free.

    Rules: rows with ``minutes < BASELINE_MIN_MINUTES`` are dropped before
    anything else. Rank buckets are league-wide terciles (``numpy.quantile``
    on the filtered ``rank`` column) — the SAME two cut points are reused for
    every role, matching ``impact.BaselineSet.bucket_for`` (which is
    role-agnostic). Event stats (``EVENT_STATS``) are aggregated only over
    ``has_killfeed`` rows (a match with no kill-feed contributes nothing to
    those baselines, rather than dragging the mean toward zero). Every
    (role, stat) pair emits 4 rows: bucket ``-1`` (role-wide) plus one row per
    rank bucket ``0..RANK_BUCKETS-1``, even if a bucket has zero matching rows
    (mean/std default to 0.0 in that case).
    """
    df = stats[stats["minutes"] >= BASELINE_MIN_MINUTES].copy()
    if df.empty:
        return []

    ranks = df["rank"].to_numpy(dtype=float)
    bucket_bounds = [float(b) for b in np.quantile(ranks, [1 / 3, 2 / 3])]
    meta = {"bucket_bounds": bucket_bounds, "n": len(df)}

    def _bucket_for(rank: float) -> int:
        for i, bound in enumerate(bucket_bounds):
            if rank <= bound:
                return i
        return len(bucket_bounds)

    df["rank_bucket"] = df["rank"].map(_bucket_for)

    rows: list[dict] = []
    for role, role_df in df.groupby("role"):
        for stat in _STAT_NAMES:
            col = f"{stat}_rate"
            is_event = stat in EVENT_STATS
            base_df = role_df[role_df["has_killfeed"]] if is_event else role_df
            rows.append(_baseline_row(role, -1, stat, base_df[col], meta))
            for bucket in range(RANK_BUCKETS):
                bucket_df = role_df[role_df["rank_bucket"] == bucket]
                if is_event:
                    bucket_df = bucket_df[bucket_df["has_killfeed"]]
                rows.append(_baseline_row(role, bucket, stat, bucket_df[col], meta))
    return rows


def _baseline_row(role: str, rank_bucket: int, stat: str, series: pd.Series, meta: dict) -> dict:
    mean = float(series.mean()) if len(series) else 0.0
    if pd.isna(mean):
        mean = 0.0
    std = float(series.std(ddof=1)) if len(series) > 1 else 0.0
    if pd.isna(std):
        std = 0.0
    return {
        "role": role,
        "rank_bucket": rank_bucket,
        "stat": stat,
        "mean": mean,
        "std": std,
        "meta": dict(meta),
    }
