"""Standings v2 — the two pairwise feature frames.

:func:`build_standings_training_frame` is the **labelled** one: one row per
historical ``Encounter``, carrying home/away strength summaries plus the
realised ``home_won``. Features are re-derived from the lighter-weight
``extract_encounter_features`` extractor and enriched with the pre-tournament
OpenSkill ``mu`` snapshot and per-team mean ``Performance v2 raw_value`` (when
available). It trains the win-probability classifier and also backs Match
Quality scoring.

:func:`build_standings_forecast_frame` is the **unlabelled** one that Stage B
simulates: a virtual double round robin over the registered teams. It is
deliberately not encounter-driven — see its docstring.
"""

from __future__ import annotations

import itertools
import typing

import numpy as np
import pandas as pd
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core.workspace import workspace_scope_filter

from .extractors import extract_encounter_features
from .opponent_strength import snapshot_pre_tournament_team_mu
from .synergy import team_synergy_features

__all__ = ("build_standings_forecast_frame", "build_standings_training_frame")

_ROLES = ("tank", "damage", "support")
# Per-team pre-tournament strength columns carried onto each side of a pairing.
_TEAM_MU_COLS = ("avg_mu", "max_mu", "std_mu", *(f"{role}_mu" for role in _ROLES))
_TEAM_SYNERGY_COLS = ("synergy_pairs", "synergy_winrate")


def _side_renames(side: str, extra: tuple[str, ...] = ()) -> dict[str, str]:
    """``{col: f"{side}_{col}"}`` for every per-team strength/synergy column."""
    return {col: f"{side}_{col}" for col in (*extra, *_TEAM_MU_COLS, *_TEAM_SYNERGY_COLS)}


def _derive_pair_gaps(df: pd.DataFrame) -> pd.DataFrame:
    """Home-minus-away gaps over the merged per-side strength columns.

    NaN propagates: a missing side (unrated roster, no co-play history) yields a
    missing gap, which the booster routes natively — see ``_feature_matrix``.
    """
    df["mu_gap"] = df["home_avg_mu"] - df["away_avg_mu"]
    df["max_mu_gap"] = df["home_max_mu"] - df["away_max_mu"]
    for role in _ROLES:
        df[f"role_mu_gap_{role}"] = df[f"home_{role}_mu"] - df[f"away_{role}_mu"]
    df["synergy_winrate_gap"] = df["home_synergy_winrate"] - df["away_synergy_winrate"]
    return df


async def _team_performance_mean(
    session: AsyncSession,
    tournament_ids: typing.Sequence[int],
) -> pd.DataFrame:
    """Return ``(tournament_id, team_id, avg_perf)`` from ``analytics.performance``.

    Used to enrich the win-prob features. Returns empty DataFrame if v2
    Performance has not been materialised yet.
    """
    if not tournament_ids:
        return pd.DataFrame()
    query = (
        sa.select(
            models.AnalyticsPerformance.tournament_id.label("tournament_id"),
            models.Player.team_id.label("team_id"),
            sa.func.avg(models.AnalyticsPerformance.raw_value).label("avg_perf"),
        )
        .join(
            models.Player,
            models.Player.id == models.AnalyticsPerformance.player_id,
        )
        .where(models.AnalyticsPerformance.tournament_id.in_(tournament_ids))
        .group_by(
            models.AnalyticsPerformance.tournament_id,
            models.Player.team_id,
        )
    )
    result = await session.execute(query)
    return pd.DataFrame(result.mappings().all())


async def _team_rank_stats(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
) -> pd.DataFrame:
    """Return ``(team_id, avg_rank, std_rank)`` for a tournament's rosters.

    The same per-side aggregate ``extract_encounter_features`` computes for the
    two teams of an encounter — identical ``is_substitution`` exclusion — but
    keyed by team, so it still yields rows when the tournament has no encounters
    to hang the aggregate off. Teams with no non-substitute players drop out:
    there is nothing to rate them by.
    """
    query = (
        sa.select(
            models.Team.id.label("team_id"),
            sa.func.avg(models.Player.rank).label("avg_rank"),
            sa.func.coalesce(sa.func.stddev_samp(models.Player.rank), 0).label("std_rank"),
        )
        .select_from(models.Team)
        .join(models.Tournament, models.Tournament.id == models.Team.tournament_id)
        .join(
            models.Player,
            sa.and_(
                models.Player.team_id == models.Team.id,
                models.Player.is_substitution.is_(False),
            ),
        )
        .where(
            models.Team.tournament_id == tournament_id,
            *workspace_scope_filter(workspace_id, workspace_ids),
        )
        .group_by(models.Team.id)
    )
    result = await session.execute(query)
    df = pd.DataFrame(result.mappings().all())
    if df.empty:
        return pd.DataFrame(columns=["team_id", "avg_rank", "std_rank"])
    # PostgreSQL returns ``AVG``/``STDDEV_SAMP`` as ``Decimal`` → object dtype.
    df["team_id"] = df["team_id"].astype(int)
    for col in ("avg_rank", "std_rank"):
        df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)
    return df


async def build_standings_forecast_frame(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
) -> pd.DataFrame:
    """Virtual double round robin over a tournament's registered teams.

    This — not the tournament's own encounters — is what the Monte Carlo
    simulator ranks, for two reasons.

    **The realised schedule leaks the result.** Which teams meet in a semifinal
    is decided by who won the quarterfinals, and ``_round_robin_standings``
    ranks by win count over whatever pairings it is handed. An eliminated team
    appears in one encounter and can bank at most one win; a finalist appears in
    several. Simulating the played bracket therefore ranks teams by how far they
    actually advanced: with eight *identical* teams (every ``p_home_wins`` at
    0.5) the realised single-elimination bracket hands the finalists a ~28%
    chance of first place and the round-one losers ~1.5%, purely from the shape
    of the schedule. ``predicted_place`` would restate the standings instead of
    forecasting them, and ``placement_delta`` — which the analytics summary
    reads as over/underperformance — would be structurally squashed toward zero.
    It is the same leak the model already refuses at the feature level, where
    ``STANDINGS_FEATURE_ORDER`` excludes same-tournament Performance v2.

    **An unplayed bracket has no schedule at all.** Before the first match there
    is nothing to simulate, yet the field is fully known and worth forecasting.

    An all-play-all needs neither. Pairs are emitted in **both** orders, so each
    team meets every opponent once at home and once away and whatever home-side
    bias the classifier learned cancels out instead of favouring one arbitrary
    side of the pairing. Strength comes from registration ranks plus a strictly
    pre-tournament OpenSkill snapshot, so nothing that happens inside the
    tournament can reach its own forecast.

    Emits every column of ``STANDINGS_FEATURE_ORDER`` plus ``tournament_id`` /
    ``home_team_id`` / ``away_team_id``. There is no ``home_won`` label —
    this frame is inference-only. Empty when fewer than two teams can be rated.
    """
    rank_stats = await _team_rank_stats(
        session,
        tournament_id,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    if len(rank_stats) < 2:
        return pd.DataFrame()

    mu = await snapshot_pre_tournament_team_mu(
        session,
        tournament_id,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    synergy = await team_synergy_features(
        session,
        tournament_id,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    strength = rank_stats.merge(mu[["team_id", *_TEAM_MU_COLS]], on="team_id", how="left").merge(
        synergy, on="team_id", how="left"
    )

    team_ids = sorted(int(team_id) for team_id in strength["team_id"])
    pairs = pd.DataFrame(
        itertools.permutations(team_ids, 2),
        columns=["home_team_id", "away_team_id"],
    )
    home = strength.rename(columns={"team_id": "home_team_id", **_side_renames("home", ("avg_rank", "std_rank"))})
    away = strength.rename(columns={"team_id": "away_team_id", **_side_renames("away", ("avg_rank", "std_rank"))})
    df = pairs.merge(home, on="home_team_id", how="left").merge(away, on="away_team_id", how="left")
    df["tournament_id"] = tournament_id
    df["rank_gap"] = df["home_avg_rank"] - df["away_avg_rank"]
    df = _derive_pair_gaps(df)
    return df.replace([np.inf, -np.inf], np.nan)


async def build_standings_training_frame(
    session: AsyncSession,
    tournament_ids: typing.Iterable[int],
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
) -> pd.DataFrame:
    """Return one row per historical encounter with ML features + ``home_won`` label."""
    tournament_ids = sorted({int(t) for t in tournament_ids})
    if not tournament_ids:
        return pd.DataFrame()

    encounters = await extract_encounter_features(
        session,
        tournament_ids,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    if encounters.empty:
        return encounters

    perf = await _team_performance_mean(session, tournament_ids)

    # OpenSkill mu + roster synergy — the SAME pre-tournament features inference
    # uses, keyed by (tournament_id, team_id). The old per-encounter snapshot
    # trained the model on mid-tournament ratings inference could never observe
    # (train/serve skew) and once fanned the frame out ~88x through duplicate
    # snapshot rows. Both are strictly pre-tournament BY DATE (ids are not
    # chronological here), so nothing played after a tournament's start reaches
    # its own training rows.
    team_frames: list[pd.DataFrame] = []
    for tid in tournament_ids:
        snap = await snapshot_pre_tournament_team_mu(
            session,
            tid,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        if snap.empty:
            continue
        synergy = await team_synergy_features(
            session,
            tid,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        team_frames.append(snap.merge(synergy, on="team_id", how="left").assign(tournament_id=tid))
    team_df = (
        pd.concat(team_frames, ignore_index=True)
        if team_frames
        else pd.DataFrame(columns=["tournament_id", "team_id", *_TEAM_MU_COLS, *_TEAM_SYNERGY_COLS])
    )

    df = encounters
    for side in ("home", "away"):
        renames = _side_renames(side)
        df = df.merge(
            team_df.rename(columns=renames)[["tournament_id", "team_id", *renames.values()]],
            left_on=["tournament_id", f"{side}_team_id"],
            right_on=["tournament_id", "team_id"],
            how="left",
        ).drop(columns=["team_id"])
    df = _derive_pair_gaps(df)

    if not perf.empty:
        perf_h = perf.rename(columns={"team_id": "home_team_id", "avg_perf": "home_avg_perf"})
        perf_a = perf.rename(columns={"team_id": "away_team_id", "avg_perf": "away_avg_perf"})
        df = df.merge(perf_h, on=["tournament_id", "home_team_id"], how="left")
        df = df.merge(perf_a, on=["tournament_id", "away_team_id"], how="left")
        df["perf_gap"] = df["home_avg_perf"].fillna(0) - df["away_avg_perf"].fillna(0)
    else:
        df["home_avg_perf"] = 0.0
        df["away_avg_perf"] = 0.0
        df["perf_gap"] = 0.0

    # Coerce numeric columns from object → float64. PostgreSQL returns
    # ``AVG(...)`` / ``STDDEV_SAMP(...)`` as ``Decimal`` which pandas keeps as
    # ``object`` dtype. XGBoost / LightGBM both reject ``object`` columns.
    numeric_cols = (
        "home_avg_rank",
        "away_avg_rank",
        "home_std_rank",
        "away_std_rank",
        *(f"{side}_{col}" for side in ("home", "away") for col in (*_TEAM_MU_COLS, *_TEAM_SYNERGY_COLS)),
        "mu_gap",
        "max_mu_gap",
        *(f"role_mu_gap_{role}" for role in _ROLES),
        "synergy_winrate_gap",
        "home_avg_perf",
        "away_avg_perf",
        "perf_gap",
        "home_score",
        "away_score",
        "home_won",
    )
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype(float)

    return df.replace([np.inf, -np.inf], np.nan)
