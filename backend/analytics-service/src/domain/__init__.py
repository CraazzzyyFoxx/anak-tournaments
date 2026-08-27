"""Pure analytics algorithms. No session, no await, no asyncio."""

from src.domain.canonical import assign_canonical_division, canonical_div_for, canonical_division_number
from src.domain.forecast import PredictedDirection, predict_player_division
from src.domain.linear import (
    LinearAnalyticsMetrics,
    TournamentSignal,
    fit_raw_signal_weights,
    score_history,
)
from src.domain.ratings import (
    AnalyticsMatch,
    compute_linear_metrics,
    compute_points_shifts,
    division_delta_points,
    get_id_role,
    get_linear_hybrid_shift_lookup,
    get_plackett_luce,
    get_player_rating,
    prepare_openskill_data,
)

__all__ = (
    "AnalyticsMatch",
    "LinearAnalyticsMetrics",
    "PredictedDirection",
    "TournamentSignal",
    "assign_canonical_division",
    "canonical_div_for",
    "canonical_division_number",
    "compute_linear_metrics",
    "compute_points_shifts",
    "division_delta_points",
    "fit_raw_signal_weights",
    "get_id_role",
    "get_linear_hybrid_shift_lookup",
    "get_plackett_luce",
    "get_player_rating",
    "predict_player_division",
    "prepare_openskill_data",
    "score_history",
)
