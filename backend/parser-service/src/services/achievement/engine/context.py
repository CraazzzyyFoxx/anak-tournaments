from __future__ import annotations

from dataclasses import dataclass

from shared.division_grid import DivisionGrid

from src import models


@dataclass(frozen=True)
class EvalContext:
    """Immutable context passed through the condition tree evaluation."""

    workspace_id: int
    tournament: models.Tournament | None = None
    grid: DivisionGrid | None = None
