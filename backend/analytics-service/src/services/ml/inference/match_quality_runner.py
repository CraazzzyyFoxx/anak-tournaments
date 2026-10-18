"""Match Quality v1 inference writer.

Match Quality is an encounter-level score. Player anomalies live in
``analytics.player_anomaly`` and are joined on read.
"""

from __future__ import annotations

import logging

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.domain.analytics import AnalyticsExports, StandingsModel
from shared.repository.stats_queries import match_context, team_scores
from src import models
from src.core.analytics_exports import tournament_module

from ..features.standings_features import build_standings_training_frame
from ..models.base import load_artifact
from ..training.registry import registry_service

logger = logging.getLogger(__name__)

__all__ = ("run_match_quality_for_tournament",)


async def _match_scores(session: AsyncSession, tournament_id: int, *, discipline: str) -> pd.DataFrame:
    """Return observed ``(encounter_id, home_score, away_score)`` per native match of ``discipline``."""
    matches = match_context(discipline=discipline)
    home = team_scores(discipline=discipline, stat_code="score")
    away = team_scores(discipline=discipline, stat_code="score")
    query = (
        sa.select(
            matches.c.encounter_id.label("encounter_id"),
            sa.cast(home.c.value, sa.Integer).label("home_score"),
            sa.cast(away.c.value, sa.Integer).label("away_score"),
        )
        .select_from(matches)
        .join(home, sa.and_(home.c.match_id == matches.c.id, home.c.source_position == 1))
        .join(away, sa.and_(away.c.match_id == matches.c.id, away.c.source_position == 2))
        .where(matches.c.tournament_id == tournament_id)
        .order_by(matches.c.encounter_id, matches.c.id)
    )
    result = await session.execute(query)
    return pd.DataFrame(result.mappings().all())


async def _standings_p_home(
    session: AsyncSession,
    tournament_id: int,
    *,
    discipline: str,
    workspace_id: int | None = None,
) -> pd.DataFrame:
    """Return the encounter feature frame used for Match Quality scoring."""
    return await build_standings_training_frame(
        session,
        [tournament_id],
        discipline=discipline,
        workspace_id=workspace_id,
    )


async def _standings_win_probability(
    session: AsyncSession,
    encounters: pd.DataFrame,
    *,
    discipline: str,
    exports: AnalyticsExports,
) -> pd.Series | None:
    """``P(home wins)`` per encounter from the discipline's active Standings v2 artifact.

    The predictability score is "how expected was the result" — it needs the
    pre-match win probability. The feature frame never carries one (it is the
    classifier's INPUT), so this used to silently stay ``None`` and every
    encounter scored a neutral 50. Returns ``None`` (neutral everywhere) when
    no usable artifact exists rather than failing the whole quality pass.
    """
    declaration = exports.MODELS["standings"]
    algorithm_id = await session.scalar(
        sa.select(models.AnalyticsAlgorithm.id).where(models.AnalyticsAlgorithm.name == declaration.algorithm_name)
    )
    if algorithm_id is None:
        return None
    artifact = await registry_service.load_active_artifact(
        session,
        discipline=discipline,
        algorithm_id=algorithm_id,
        model_kind=declaration.model_kind,
        role_id=None,
    )
    if artifact is None:
        return None
    try:
        model: StandingsModel = load_artifact(artifact.storage_uri)
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
    """Compute Match Quality rows for one tournament.

    A tournament whose discipline declares no analytics module is left as it is: nothing is computed and no existing
    row is cleared.
    """
    owned = await tournament_module(session, tournament_id)
    if owned is None:
        logger.info("Tournament %d has no analytics module; no Match Quality to compute", tournament_id)
        return 0
    discipline, exports = owned
    algorithm = await registry_service.ensure_algorithm(session, exports.MODELS["match_quality"].algorithm_name)

    encounters = await _standings_p_home(
        session,
        tournament_id,
        discipline=discipline,
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
    p_home = await _standings_win_probability(session, encounters, discipline=discipline, exports=exports)
    encounters["p_home_wins"] = p_home if p_home is not None else None

    quality = exports.compute_match_quality(
        encounters,
        await _match_scores(session, tournament_id, discipline=discipline),
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
