"""Standings v2 — loading for the two pairwise feature frames.

:func:`build_standings_training_frame` is the **labelled** one: one row per historical ``Encounter`` with the realised
``home_won``; it trains the win-probability classifier and also backs Match Quality scoring.
:func:`build_standings_forecast_frame` is the **unlabelled** virtual double round robin Stage B simulates.

This module loads what the OpenSkill replay owns (the pre-tournament mu snapshot) and dispatches to the discipline's
analytics module for its extractors, roster synergy and column construction.
"""

from __future__ import annotations

import typing

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.analytics_exports import analytics_exports

from .opponent_strength import snapshot_pre_tournament_team_mu

__all__ = ("build_standings_forecast_frame", "build_standings_training_frame")


async def build_standings_forecast_frame(
    session: AsyncSession,
    tournament_id: int,
    *,
    discipline: str,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
) -> pd.DataFrame:
    """Virtual double round robin over a tournament's registered teams (inference-only, no ``home_won`` label).

    The module documents why the realised schedule is never simulated. Strength comes from registration ranks plus a
    strictly pre-tournament OpenSkill snapshot. Empty when fewer than two teams can be rated.
    """
    exports = analytics_exports(discipline)
    rank_stats = await exports.team_rank_stats(
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
        discipline=discipline,
    )
    synergy = await exports.team_synergy_features(
        session,
        tournament_id,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    return exports.standings_forecast_frame(rank_stats, mu, synergy, tournament_id=tournament_id)


async def build_standings_training_frame(
    session: AsyncSession,
    tournament_ids: typing.Iterable[int],
    *,
    discipline: str,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
) -> pd.DataFrame:
    """Return one row per historical encounter with ML features + ``home_won`` label."""
    tournament_ids = sorted({int(t) for t in tournament_ids})
    if not tournament_ids:
        return pd.DataFrame()

    exports = analytics_exports(discipline)
    encounters = await exports.extract_encounter_features(
        session,
        tournament_ids,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    if encounters.empty:
        return encounters

    performance = await exports.team_performance_mean(session, tournament_ids)

    # OpenSkill mu + roster synergy — the SAME pre-tournament features inference uses, keyed by
    # (tournament_id, team_id); each is strictly pre-tournament BY DATE (ids are not chronological here), so nothing
    # played after a tournament's start reaches its own training rows.
    team_frames: list[pd.DataFrame] = []
    for tid in tournament_ids:
        snapshot = await snapshot_pre_tournament_team_mu(
            session,
            tid,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
            discipline=discipline,
        )
        if snapshot.empty:
            continue
        synergy = await exports.team_synergy_features(
            session,
            tid,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
        )
        team_frames.append(exports.team_strength_frame(snapshot, synergy, tournament_id=tid))
    return exports.standings_training_frame(encounters, team_frames, performance)
