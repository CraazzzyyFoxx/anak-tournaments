"""Roll-up helpers that combine extractor frames with opponent-strength snapshots.

Wired by :mod:`src.services.ml.training.orchestrator` and
:mod:`src.services.ml.inference.runner`. The cache, the extractor dispatch and the OpenSkill snapshot loading live
here; the feature columns built from those frames belong to the discipline's analytics module.
"""

from __future__ import annotations

import typing

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.analytics_exports import OVERWATCH, analytics_exports

from .cache import get_or_build_dataframe, scope_cache_params
from .opponent_strength import snapshot_pre_encounter_team_mu

__all__ = (
    "build_match_features_with_strength",
    "build_tournament_feature_frame",
)


async def build_match_features_with_strength(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    params = {
        "tournament_id": int(tournament_id),
        "look_back": int(look_back),
        **scope_cache_params(workspace_id=workspace_id, workspace_ids=workspace_ids),
    }

    async def _build() -> pd.DataFrame:
        return await _build_match_features_with_strength_uncached(
            session,
            tournament_id,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
            look_back=look_back,
        )

    return await get_or_build_dataframe("match_features_with_strength", params, _build)


async def _build_match_features_with_strength_uncached(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    """Return the match feature frame enriched with pre-encounter OpenSkill mu.

    The snapshot is :func:`snapshot_pre_encounter_team_mu`; the module joins it on ``(encounter_id, team_id)``.
    """
    exports = analytics_exports(OVERWATCH)
    matches = await exports.extract_match_features(
        session,
        [tournament_id],
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    if matches.empty:
        return matches

    snapshots = await snapshot_pre_encounter_team_mu(
        session,
        tournament_id,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
        look_back=look_back,
    )
    return exports.attach_encounter_strength(matches, snapshots)


async def build_tournament_feature_frame(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    params = {
        "tournament_id": int(tournament_id),
        "look_back": int(look_back),
        **scope_cache_params(workspace_id=workspace_id, workspace_ids=workspace_ids),
    }

    async def _build() -> pd.DataFrame:
        return await _build_tournament_feature_frame_uncached(
            session,
            tournament_id,
            workspace_id=workspace_id,
            workspace_ids=workspace_ids,
            look_back=look_back,
        )

    return await get_or_build_dataframe("tournament_feature_frame", params, _build)


async def _build_tournament_feature_frame_uncached(
    session: AsyncSession,
    tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
    look_back: int = 10,
) -> pd.DataFrame:
    """Convenience wrapper used by the Performance v2 inference runner."""
    exports = analytics_exports(OVERWATCH)
    df = await exports.extract_tournament_features(
        session,
        [tournament_id],
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
    )
    if df.empty:
        return df

    matches = await build_match_features_with_strength(
        session,
        tournament_id,
        workspace_id=workspace_id,
        workspace_ids=workspace_ids,
        look_back=look_back,
    )
    return exports.attach_tournament_strength(df, matches)
