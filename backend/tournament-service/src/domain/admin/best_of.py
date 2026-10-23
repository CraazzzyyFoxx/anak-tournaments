"""Per-round best-of resolution for bracket generation and backfill.

The configuration lives on the stage: ``Stage.best_of_default`` (the fallback),
``Stage.best_of_final`` (an elimination stage's last round, NULL = none), one
``StageRoundBestOf`` row per round with its own length, and a Swiss stage's
``best_of_swiss_qualify`` / ``best_of_swiss_eliminate`` (a decisive match).

Resolution precedence for an encounter in round ``R`` of stage ``S``:

1. ``S`` is elimination AND ``R`` == the max round of the generated set AND
   ``final`` is set -> ``final``.
2. ``S`` is Swiss and the encounter can put a team through / out, with that
   length set -> it (the larger when it can do both): :func:`resolve_swiss_best_of`.
3. ``R`` has a round row -> that row's best-of.
4. otherwise -> ``default``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

DEFAULT_BEST_OF = 3


@dataclass
class BestOfConfig:
    default: int = DEFAULT_BEST_OF
    by_round: dict[int, int] = field(default_factory=dict)
    final: int | None = None
    swiss_qualify: int | None = None
    swiss_eliminate: int | None = None


def best_of_config(stage: Any) -> BestOfConfig:
    """The stage's series lengths, as the resolver reads them."""
    return BestOfConfig(
        default=stage.best_of_default,
        by_round={row.round: row.best_of for row in stage.round_best_of},
        final=stage.best_of_final,
        swiss_qualify=stage.best_of_swiss_qualify,
        swiss_eliminate=stage.best_of_swiss_eliminate,
    )


def resolve_best_of(cfg: BestOfConfig, round_number: int, *, is_final: bool) -> int:
    """Resolve the best-of for a single encounter (see module docstring)."""
    if is_final and cfg.final is not None:
        return cfg.final
    if round_number in cfg.by_round:
        return cfg.by_round[round_number]
    return cfg.default


def resolve_swiss_best_of(cfg: BestOfConfig, round_number: int, *, qualification: bool, elimination: bool) -> int:
    """A Swiss encounter's best-of, given what it can decide (``SwissThresholds.stakes``)."""
    decisive = [
        best_of
        for best_of, at_stake in ((cfg.swiss_qualify, qualification), (cfg.swiss_eliminate, elimination))
        if at_stake and best_of is not None
    ]
    return max(decisive) if decisive else resolve_best_of(cfg, round_number, is_final=False)
