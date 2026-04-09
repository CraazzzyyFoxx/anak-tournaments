"""Leaf condition registry.

Each leaf executor is an async function with signature:
    async def execute(session, params, context) -> ResultSet
"""

from __future__ import annotations

from typing import Any, Callable, Coroutine

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.enums import LogStatsName
from src import models

# PostgreSQL enum stores PascalCase names (e.g. 'Performance'),
# while Python StrEnum has lowercase values (e.g. 'performance').
# We need to resolve both formats to the DB-stored PascalCase name.
_LOWERCASE_TO_NAME: dict[str, str] = {m.value: m.name for m in LogStatsName}


def resolve_stat_name(raw: str) -> str:
    """Resolve a stat name to the PascalCase format stored in PostgreSQL.

    Accepts both 'Performance' (PascalCase) and 'performance' (lowercase).
    Returns the PascalCase name that matches the DB enum value.
    """
    # If it's already PascalCase (a member name), return as-is
    if raw in {m.name for m in LogStatsName}:
        return raw
    # If it's lowercase (a value), map to PascalCase name
    return _LOWERCASE_TO_NAME.get(raw, raw)

from ..context import EvalContext

ResultSet = set[tuple[int, ...]]

LeafExecutor = Callable[
    [AsyncSession, dict[str, Any], EvalContext],
    Coroutine[Any, Any, ResultSet],
]

_REGISTRY: dict[str, LeafExecutor] = {}


def register(name: str):
    """Decorator to register a leaf condition executor."""

    def decorator(fn: LeafExecutor) -> LeafExecutor:
        _REGISTRY[name] = fn
        return fn

    return decorator


async def execute_leaf(
    session: AsyncSession,
    condition_type: str,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Dispatch to the appropriate leaf executor."""
    executor = _REGISTRY.get(condition_type)
    if executor is None:
        raise ValueError(f"Unknown condition type: {condition_type!r}")
    return await executor(session, params, context)


async def get_all_eligible_users(
    session: AsyncSession,
    context: EvalContext,
) -> ResultSet:
    """Get all users in the workspace as (user_id,) tuples."""
    query = (
        sa.select(models.Player.user_id.distinct())
        .join(models.Tournament, models.Tournament.id == models.Player.tournament_id)
        .where(models.Tournament.workspace_id == context.workspace_id)
    )
    result = await session.execute(query)
    return {(row[0],) for row in result}


def get_registered_types() -> list[str]:
    """Return all registered condition type names."""
    return sorted(_REGISTRY.keys())


# Import all condition modules to trigger registration.
from . import (  # noqa: E402, F401
    aggregate,
    bracket,
    division,
    encounter,
    hero,
    match_criteria,
    match_win,
    mvp,
    player,
    standing,
    stat_threshold,
    streak,
    team,
    tournament_format,
)
