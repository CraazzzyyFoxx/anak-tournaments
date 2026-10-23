"""The Overwatch analytics module: features, models and the canonical division scale.

``DisciplineSpec.analytics`` returns *this module*; the names below are its ``AnalyticsExports`` contract
(``shared.domain.analytics``). Importing it loads pandas and the estimators, so the registry imports it only when a
service actually runs analytics.
"""

from __future__ import annotations

from shared.domain.analytics import (
    INFERENCE_KINDS,
    MATCH_QUALITY_MODEL,
    PERFORMANCE_MODEL,
    SHIFT_MODEL,
    STANDINGS_MODEL,
)

from .canonical import assign_canonical_division, canonical_div_for
from .features.aggregations import attach_encounter_strength, attach_tournament_strength
from .features.extractors import (
    extract_encounter_features,
    extract_match_features,
    extract_round_residuals,
    extract_tournament_features,
)
from .features.local_performance import attach_local_performance
from .features.mvp_dominance import compute_mvp_dominance
from .features.opponent_strength import summarize_team_strength
from .features.player_profile import load_player_signal_profile
from .features.role_kpis import COARSE_FEATURES, features_for_role
from .features.shift_features import (
    assemble_shift_tournament_frame,
    concat_shift_frames,
    load_performance_features,
    load_player_rank_history,
)
from .features.standings_features import (
    standings_forecast_frame,
    standings_training_frame,
    team_performance_mean,
    team_rank_stats,
    team_strength_frame,
)
from .features.synergy import team_synergy_features
from .models.anomalies import detect_sandbags, detect_smurfs, detect_throws, detect_trolls
from .models.match_quality import compute_match_quality
from .models.performance_v2 import (
    PerformanceModelV2,
    _ConstantClassifier,
    aggregate_to_tournament,
    impact_score_within_role,
    stabilize_small_cohort_impact,
    train_performance_v2,
)
from .models.shift_v2 import ShiftModelV2, train_shift_v2
from .models.standings_v2 import WinProbabilityModel, simulate_standings, train_standings_v2

#: Model kind -> its registered algorithm name and version (the declaration the service validates artifacts against).
MODELS = {
    declaration.model_kind: declaration
    for declaration in (PERFORMANCE_MODEL, SHIFT_MODEL, STANDINGS_MODEL, MATCH_QUALITY_MODEL)
}

__all__ = (
    "COARSE_FEATURES",
    "INFERENCE_KINDS",
    "MODELS",
    "PerformanceModelV2",
    "ShiftModelV2",
    "WinProbabilityModel",
    "_ConstantClassifier",
    "aggregate_to_tournament",
    "assemble_shift_tournament_frame",
    "assign_canonical_division",
    "attach_encounter_strength",
    "attach_local_performance",
    "attach_tournament_strength",
    "canonical_div_for",
    "compute_match_quality",
    "compute_mvp_dominance",
    "concat_shift_frames",
    "detect_sandbags",
    "detect_smurfs",
    "detect_throws",
    "detect_trolls",
    "extract_encounter_features",
    "extract_match_features",
    "extract_round_residuals",
    "extract_tournament_features",
    "features_for_role",
    "impact_score_within_role",
    "load_performance_features",
    "load_player_rank_history",
    "load_player_signal_profile",
    "simulate_standings",
    "stabilize_small_cohort_impact",
    "standings_forecast_frame",
    "standings_training_frame",
    "summarize_team_strength",
    "team_performance_mean",
    "team_rank_stats",
    "team_strength_frame",
    "team_synergy_features",
    "train_performance_v2",
    "train_shift_v2",
    "train_standings_v2",
)
