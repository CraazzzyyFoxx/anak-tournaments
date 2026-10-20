"""Overwatch leaf conditions.

Importing this package registers every condition with ``shared.domain.achievements.registry`` under ``"overwatch"``
(the ``DisciplineSpec.achievement_conditions`` hook is exactly that import). Each module's ``@register`` carries its
node's contract; the value checks the generic validator must not know (closed value sets, stat names, count
companions) and which nodes read divisions across grid versions are declared there too.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from shared.core.enums import LogStatsName
from shared.domain.achievements.registry import LeafExecutor, LeafSpec, ResultSet
from shared.domain.achievements.registry import register as _register
from shared.domain.achievements.registry import register_spec as _register_spec

__all__ = ("DISCIPLINE", "ResultSet", "register", "register_spec")

DISCIPLINE = "overwatch"


def register(name: str, **contract: Any) -> Callable[[LeafExecutor], LeafExecutor]:
    """``shared`` registry ``register`` bound to this module's discipline."""
    return _register(name, discipline=DISCIPLINE, **contract)


def register_spec(spec: LeafSpec) -> LeafSpec:
    return _register_spec(spec, discipline=DISCIPLINE)


# The DSL accepts enum member names and codes; native vocabulary stores codes.
_STAT_CODES: dict[str, str] = {m.name: m.value for m in LogStatsName}
_VALID_STAT_CODES: frozenset[str] = frozenset(m.value for m in LogStatsName)
_LEGACY_STAT_ALIASES: dict[str, str] = {
    # A seeded rule's old spelling of the stat.
    "CriticalHitKills": "ScopedCriticalHitKills",
}


def resolve_stat_name(raw: str) -> str:
    """Resolve an existing DSL stat spelling to its native vocabulary code."""
    return _STAT_CODES.get(_LEGACY_STAT_ALIASES.get(raw, raw), raw)


def validate_stat_name(raw: str) -> str | None:
    """Return a validation error for unsupported stat names, if any."""
    alias = _LEGACY_STAT_ALIASES.get(raw)
    if alias is not None:
        return f"legacy stat alias '{raw}' is no longer supported; use '{alias}'"
    if raw in _STAT_CODES or raw in _VALID_STAT_CODES:
        return None
    return f"unknown stat '{raw}'"


def always(_params: dict[str, Any]) -> bool:
    """``requires_normalized_divisions`` for nodes that always read divisions."""
    return True


def one_of(**domains: tuple[str, ...]) -> Callable[[dict[str, Any]], list[str]]:
    """``validate_params`` for params whose value is drawn from a closed set; absent params pass."""

    def check(params: dict[str, Any]) -> list[str]:
        return [
            f"params.{key}: must be one of {', '.join(allowed)}"
            for key, allowed in domains.items()
            if params.get(key) is not None and params[key] not in allowed
        ]

    return check


def stat_param(params: dict[str, Any]) -> list[str]:
    """``validate_params`` for nodes with a ``stat`` param: reject unknown and retired spellings."""
    raw = params.get("stat")
    if isinstance(raw, str):
        error = validate_stat_name(raw)
        if error is not None:
            return [f"params.stat: {error}"]
    return []


# Import all condition modules to trigger registration.
from . import (  # noqa: E402, F401
    aggregate,
    bracket,
    div_span,
    division,
    draft,
    encounter,
    encounter_series,
    hero,
    hero_pickrate,
    kill_feed,
    log_stat_rank,
    map_coverage,
    match_criteria,
    match_event,
    match_win,
    mvp,
    participation,
    player,
    rank_history,
    reached_playoffs,
    registration,
    stage_completed,
    standing,
    standing_count,
    stat_threshold,
    streak,
    team,
    team_otp,
    teammate_recurrence,
    tournament_format,
    tournament_winrate,
)
