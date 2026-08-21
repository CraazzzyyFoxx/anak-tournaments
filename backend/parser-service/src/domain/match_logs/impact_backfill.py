"""Pure pivot-rebuilding + ranking helpers for the impact-scoring history backfill.

Everything here is deterministic and DB-free — turning a match's OLD stat rows
back into the two MVP pivots the live pipeline builds from a raw log, merging
in kill-feed-derived event stats, and ranking by impact. IO (reading rosters/
kill-feed/baselines, writing the 7 derived stats back) lives in
``src.services.match_logs.backfill.BackfillService``, which also documents the
idempotency contract these functions protect.
"""

from __future__ import annotations

import pandas as pd

from shared.core import impact as impact_consts
from src.core import enums

__all__ = (
    "NEW_STAT_MEMBERS",
    "rebuild_frames",
)

#: The 7 stats introduced by the MVP impact feature — everything a backfill
#: (re)derives and everything it must wipe before reinserting.
NEW_STAT_MEMBERS: tuple[enums.LogStatsName, ...] = tuple(
    enums.LogStatsName[name]
    for name in (*impact_consts.EVENT_STATS, "ImpactPoints", "ImpactRank", "OverperformanceScore")
)


def rebuild_frames(stat_rows: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Rebuild the round-discrete and match-total MVP pivots from OLD stat rows.

    ``stat_rows`` columns: ``user_id, round, hero_id, name (LogStatsName
    member), value`` — a match's ``matches.statistics`` rows. Pure and
    DB-free; PROTECTS the idempotency contract by dropping (a) per-hero rows
    (``hero_id`` not null — only hero-NULL "all heroes" rows feed MVP
    scoring) and (b) any row already named one of the 7 derived stats, so a
    second backfill run never treats a first run's output as new input.

    Returns ``(round_df, match_df)``: ``round_df`` pivots ``round > 0`` rows
    (per-round discrete stats), ``match_df`` pivots ``round == 0`` rows
    (match totals). Both are indexed by ``user_id`` (+ ``round``), carry a
    ``player_id`` column equal to ``user_id`` (backfill has no roster id to
    key by), and expose stat columns as ``LogStatsName`` members — exactly
    what ``impact.add_impact_scores`` expects.
    """
    hero_null = stat_rows[stat_rows["hero_id"].isna()]
    old_only = hero_null[~hero_null["name"].isin(NEW_STAT_MEMBERS)]

    round_df = _pivot(old_only[old_only["round"] > 0])
    match_df = _pivot(old_only[old_only["round"] == 0])
    return round_df, match_df


def _pivot(rows: pd.DataFrame) -> pd.DataFrame:
    if rows.empty:
        return pd.DataFrame(columns=["user_id", "round", "player_id"])
    pivot = rows.pivot_table(index=["user_id", "round"], columns="name", values="value", fill_value=0.0).reset_index()
    pivot.columns.name = None
    pivot["player_id"] = pivot["user_id"].astype(int)
    return pivot


def _merge_events(
    round_df: pd.DataFrame, match_df: pd.DataFrame, events_df: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Merge kill-feed-derived event stats into both MVP pivots + fillna(0).

    Mirrors ``flows.create_stats``'s merge (Task 5) exactly, except keyed by
    ``user_id`` — backfill's pivots carry no roster ``player.id``.
    """
    round_df = round_df.copy()
    match_df = match_df.copy()
    event_member_cols = {s: enums.LogStatsName[s] for s in impact_consts.EVENT_STATS}

    round_events = events_df[events_df["round"] > 0] if not events_df.empty else events_df
    if not round_events.empty:
        round_df = round_df.merge(
            round_events[["user_id", "round", *impact_consts.EVENT_STATS]].rename(columns=event_member_cols),
            on=["user_id", "round"],
            how="left",
        )
        totals = round_events.groupby("user_id", as_index=False)[list(impact_consts.EVENT_STATS)].sum()
        totals["round"] = 0
        match_df = match_df.merge(
            totals[["user_id", "round", *impact_consts.EVENT_STATS]].rename(columns=event_member_cols),
            on=["user_id", "round"],
            how="left",
        )

    for df_ in (round_df, match_df):
        for stat_name in impact_consts.EVENT_STATS:
            member = enums.LogStatsName[stat_name]
            if member not in df_.columns:
                df_[member] = 0.0
            df_[member] = df_[member].fillna(0.0)

    return round_df, match_df


def _rank_by_impact(df: pd.DataFrame) -> pd.DataFrame:
    """Same ranking recipe as Task 5: sort by (round, ImpactPoints desc), rank within round."""
    ranked = df.sort_values(by=["round", enums.LogStatsName.ImpactPoints], ascending=[True, False])
    ranked[enums.LogStatsName.ImpactRank] = ranked.groupby("round").cumcount() + 1
    return ranked
