"""Column construction that combines extractor frames with opponent-strength snapshots.

The service loads the frames (extractors, the OpenSkill replay snapshot, the cache) and hands them here; this module owns
only the Overwatch feature columns built from them (``team_*``/``opp_*`` mu and ``mu_gap``).
"""

from __future__ import annotations

import typing

import numpy as np
import pandas as pd

__all__ = ("attach_encounter_strength", "attach_tournament_strength")


def attach_encounter_strength(matches: pd.DataFrame, snapshots: pd.DataFrame) -> pd.DataFrame:
    """Return ``matches`` enriched with pre-encounter OpenSkill mu.

    Adds columns ``team_avg_mu``, ``opp_avg_mu``, ``opp_max_mu``, ``opp_min_mu``, ``mu_gap`` to each match row by
    joining ``snapshots`` (one row per ``(encounter_id, team_id)``) on ``(encounter_id, team_id)``. Empty ``matches``
    are returned unchanged.
    """
    if matches.empty:
        return matches

    if snapshots.empty:
        for col in ("team_avg_mu", "opp_avg_mu", "opp_max_mu", "opp_min_mu", "mu_gap"):
            matches[col] = np.nan
        return matches

    own = snapshots.rename(columns={"avg_mu": "team_avg_mu", "max_mu": "team_max_mu", "min_mu": "team_min_mu"})[
        ["encounter_id", "team_id", "team_avg_mu", "team_max_mu", "team_min_mu"]
    ]

    opp = snapshots.rename(columns={"avg_mu": "opp_avg_mu", "max_mu": "opp_max_mu", "min_mu": "opp_min_mu"})[
        ["encounter_id", "team_id", "opp_avg_mu", "opp_max_mu", "opp_min_mu"]
    ]

    merged = matches.merge(own, on=["encounter_id", "team_id"], how="left")

    # Map opponent team_id per row: home rows use away team's snapshot and vv.
    def _opp_team_id(row: pd.Series) -> typing.Any:
        return row["away_team_id"] if row["is_home"] else row["home_team_id"]

    merged["opp_team_id"] = merged.apply(_opp_team_id, axis=1)
    merged = merged.merge(
        opp.rename(columns={"team_id": "opp_team_id"}),
        on=["encounter_id", "opp_team_id"],
        how="left",
    )
    merged["mu_gap"] = merged["team_avg_mu"] - merged["opp_avg_mu"]
    return merged


def attach_tournament_strength(tournament_features: pd.DataFrame, matches: pd.DataFrame) -> pd.DataFrame:
    """Average the per-match mu columns of ``matches`` into the per-(player, tournament) ``tournament_features``."""
    if tournament_features.empty:
        return tournament_features

    # Aggregate mu features into per-(player, tournament) rows by averaging
    # the per-match snapshots already merged for the training step.
    if matches.empty:
        for col in ("team_avg_mu", "opp_avg_mu", "mu_gap"):
            tournament_features[col] = np.nan
        return tournament_features

    mu = (
        matches.groupby(["tournament_id", "player_id"], dropna=False)[["team_avg_mu", "opp_avg_mu", "mu_gap"]]
        .mean()
        .reset_index()
    )
    return tournament_features.merge(mu, on=["tournament_id", "player_id"], how="left")
