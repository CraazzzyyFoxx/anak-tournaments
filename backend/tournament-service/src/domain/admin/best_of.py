"""Per-round best-of resolution for bracket generation and backfill.

The configuration lives in ``Stage.settings_json["best_of"]`` (a free-form dict,
no dedicated column). Shape::

    {"default": 3, "by_round": {"1": 2, "3": 5}, "final": 5}

- ``default``: int >= 1, fallback 3.
- ``by_round``: {round-number-string -> int >= 1}. Keys are positive round numbers.
- ``final``: int >= 1 or absent/null.

Resolution precedence for an encounter in round ``R`` of stage ``S``:

1. ``S`` is elimination AND ``R`` == the max round of the generated set AND
   ``final`` is set -> ``final``.
2. ``str(R)`` in ``by_round`` -> ``by_round[R]``.
3. otherwise -> ``default`` (or 3).
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


def _coerce_positive_int(value: Any) -> int | None:
    """Return ``value`` as an int >= 1, or ``None``. Bools are rejected."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 1:
        return value
    return None


def parse_best_of_config(settings_json: Any) -> BestOfConfig:
    """Parse ``settings_json['best_of']`` defensively into a ``BestOfConfig``.

    Any malformed input (non-dict settings, wrong value types, unparsable round
    keys) is ignored and falls back to safe defaults.
    """
    if not isinstance(settings_json, dict):
        return BestOfConfig()
    raw = settings_json.get("best_of")
    if not isinstance(raw, dict):
        return BestOfConfig()

    default = _coerce_positive_int(raw.get("default")) or DEFAULT_BEST_OF
    final = _coerce_positive_int(raw.get("final"))

    by_round: dict[int, int] = {}
    raw_by_round = raw.get("by_round")
    if isinstance(raw_by_round, dict):
        for key, value in raw_by_round.items():
            try:
                round_number = int(key)
            except (TypeError, ValueError):
                continue
            coerced = _coerce_positive_int(value)
            if coerced is not None:
                by_round[round_number] = coerced

    return BestOfConfig(default=default, by_round=by_round, final=final)


def resolve_best_of(cfg: BestOfConfig, round_number: int, *, is_final: bool) -> int:
    """Resolve the best-of for a single encounter (see module docstring)."""
    if is_final and cfg.final is not None:
        return cfg.final
    if round_number in cfg.by_round:
        return cfg.by_round[round_number]
    return cfg.default
