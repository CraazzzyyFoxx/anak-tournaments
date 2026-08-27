"""Match Quality v1 inference writer.

Match Quality is an encounter-level score. Player anomalies live in
``analytics.player_anomaly`` and are joined on read.
"""

from __future__ import annotations

import logging

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models

from ..features.standings_features import build_standings_training_frame
from ..models.base import load_artifact
from ..models.match_quality import compute_match_quality
from ..models.standings_v2 import WinProbabilityModel
from ..training.orchestrator import (
    MATCH_QUALITY_ALGORITHM_NAME,
    STANDINGS_ALGORITHM_NAME,
    STANDINGS_MODEL_KIND,
)
from ..training.registry import registry_service

logger = logging.getLogger(__name__)

__all__ = ("run_match_quality_for_tournament",)


async def _match_scores(session: AsyncSession, tournament_id: int) -> pd.DataFrame:
    """Return ``(encounter_id, home_score, away_score)`` per ``Match``."""
    query = (
        sa.select(
            models.Match.encounter_id.label("encounter_id"),
            models.Match.home_score.label("home_score"),
            models.Match.away_score.label("away_score"),
        )
        .join(models.Encounter, models.Encounter.id == models.Match.encounter_id)
        .where(models.Encounter.tournament_id == tournament_id)
        .order_by(models.Match.encounter_id, models.Match.id)
    )
    result = await session.execute(query)
    return pd.DataFrame(result.mappings().all())


async def _standings_p_home(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
) -> pd.DataFrame:
    """Return the encounter feature frame used for Match Quality scoring."""
    return await build_standings_training_frame(
        session,
        [tournament_id],
        workspace_id=workspace_id,
    )


async def _standings_win_probability(
    session: AsyncSession,
    encounters: pd.DataFrame,
) -> pd.Series | None:
    """``P(home wins)`` per encounter from the active Standings v2 artifact.

    The predictability score is "how expected was the result" — it needs the
    pre-match win probability. The feature frame never carries one (it is the
    classifier's INPUT), so this used to silently stay ``None`` and every
    encounter scored a neutral 50. Returns ``None`` (neutral everywhere) when
    no usable artifact exists rather than failing the whole quality pass.
    """
    algorithm_id = await session.scalar(
        sa.select(models.AnalyticsAlgorithm.id).where(models.AnalyticsAlgorithm.name == STANDINGS_ALGORITHM_NAME)
    )
    if algorithm_id is None:
        return None
    artifact = await registry_service.load_active_artifact(
        session,
        algorithm_id=algorithm_id,
        model_kind=STANDINGS_MODEL_KIND,
        role=None,
    )
    if artifact is None:
        return None
    try:
        model: WinProbabilityModel = load_artifact(artifact.storage_uri)
    except FileNotFoundError:
        logger.warning("Missing standings v2 artifact at %s; predictability stays neutral", artifact.storage_uri)
        return None
    return pd.Series(model.predict_proba(encounters), index=encounters.index, name="p_home_wins")


async def run_match_quality_for_tournament(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
) -> int:
    """Compute Match Quality rows for one tournament."""
    algorithm = await registry_service.ensure_algorithm(session, MATCH_QUALITY_ALGORITHM_NAME)

    encounters = await _standings_p_home(
        session,
        tournament_id,
        workspace_id=workspace_id,
    )
    if encounters.empty:
        logger.info(
            "No encounters for tournament_id=%d (workspace_id=%s); nothing to score",
            tournament_id,
            workspace_id,
        )
        return 0

    encounters = encounters.copy()
    p_home = await _standings_win_probability(session, encounters)
    encounters["p_home_wins"] = p_home if p_home is not None else None

    quality = compute_match_quality(
        encounters,
        await _match_scores(session, tournament_id),
    )
    if quality.empty:
        return 0

    rows = [
        {
            "encounter_id": int(row["encounter_id"]),
            "algorithm_id": algorithm.id,
            "competitiveness": float(row["competitiveness"]),
            "predictability": float(row["predictability"]),
            "skill_balance": float(row["skill_balance"]),
            "quality_score": float(row["quality_score"]),
        }
        for _, row in quality.iterrows()
    ]

    # Idempotent upsert: clear every row for THIS tournament's encounters under
    # this algorithm before re-inserting. Scoping the delete by the tournament's
    # encounters (not by the ``encounters`` frame's ids) keeps it correct even
    # when the scored set (``quality``) and the standings frame diverge — a
    # mismatch otherwise leaves stale rows and a re-run hits
    # ``uq_analytics_match_quality (encounter_id, algorithm_id)``.
    await session.execute(
        sa.delete(models.AnalyticsMatchQuality).where(
            models.AnalyticsMatchQuality.algorithm_id == algorithm.id,
            models.AnalyticsMatchQuality.encounter_id.in_(
                sa.select(models.Encounter.id).where(models.Encounter.tournament_id == tournament_id)
            ),
        )
    )
    if rows:
        await session.execute(sa.insert(models.AnalyticsMatchQuality), rows)
    await session.commit()
    return len(rows)
