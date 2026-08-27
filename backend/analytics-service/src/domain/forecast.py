"""Player division forecast from a shift signal. No session."""

from __future__ import annotations

import typing

PredictedDirection = typing.Literal["promote", "demote", "flat"]

__all__ = ("PredictedDirection", "predict_player_division")


def predict_player_division(
    current_division: int | None,
    points: float,
) -> tuple[int | None, PredictedDirection, int]:
    """Forecast the next division from a shift signal in division units.

    A division is 100 signal points. A signal below 1.0 is ignored (flat).
    Magnitude rounds to whole divisions, clamped to ±3.
    Positive points = promote (lower division number) → negative delta.
    """
    delta = -round(float(points))
    if abs(float(points)) < 1.0:
        delta = 0
    delta = max(-3, min(3, delta))

    if delta < 0:
        direction: PredictedDirection = "promote"
    elif delta > 0:
        direction = "demote"
    else:
        direction = "flat"

    if current_division is None:
        return None, direction, 0

    predicted = max(1, current_division + delta)
    return predicted, direction, predicted - current_division
