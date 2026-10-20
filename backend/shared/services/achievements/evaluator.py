"""Condition tree evaluator.

Recursively evaluates a JSON condition tree (AND / OR / NOT / leaf)
and returns a set of qualifying tuples.

Tuple shapes depend on grain:
  - user grain:            (user_id,)
  - user_tournament grain: (user_id, tournament_id)
  - user_match grain:      (user_id, tournament_id, match_id)
"""

from __future__ import annotations

from functools import reduce
from typing import Any

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from shared.disciplines import discipline as _discipline
from shared.domain.achievements.context import EvalContext
from shared.domain.achievements.registry import ResultSet, get_executor
from shared.domain.achievements.validation import GRAIN_ARITY, infer_grain, leaf_grain
from shared.models.achievements.achievement import AchievementGrain


class GrainMismatchError(ValueError):
    """AND/OR/NOT or a leaf produced keys of mixed or unexpected grain."""


async def execute_leaf(
    session: AsyncSession,
    condition_type: str,
    params: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Run the executor ``context.discipline`` registered for ``condition_type``."""
    return await get_executor(condition_type, discipline=context.discipline)(session, params, context)


async def evaluate(
    session: AsyncSession,
    condition: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Evaluate one rule; uncertain series stay unknown even under NOT/OR."""
    context.deferred_encounter_ids.clear()
    results = await _evaluate(session, condition, context)
    if context.deferred_encounter_ids:
        if infer_grain(condition, discipline=context.discipline) is not AchievementGrain.user_encounter:
            raise GrainMismatchError("Deferred series chronology requires user_encounter grain")
        return {key for key in results if key[2] not in context.deferred_encounter_ids}
    return results


async def _evaluate(
    session: AsyncSession,
    condition: dict[str, Any],
    context: EvalContext,
) -> ResultSet:
    """Evaluate a node without resetting the enclosing rule's chronology holds."""

    if "AND" in condition:
        children = condition["AND"]
        if not children:
            return set()
        sets = [await _evaluate(session, child, context) for child in children]
        _require_uniform_arity(sets, "AND")
        return reduce(set.intersection, sets)

    if "OR" in condition:
        children = condition["OR"]
        if not children:
            return set()
        sets = [await _evaluate(session, child, context) for child in children]
        _require_uniform_arity(sets, "OR")
        return reduce(set.union, sets)

    if "NOT" in condition:
        matching = await _evaluate(session, condition["NOT"], context)
        grain = infer_grain(condition["NOT"], discipline=context.discipline)
        # A game without the hook has no universe to complement against: unsupported, never "everyone".
        eligible_keys = _discipline(context.discipline).achievement_eligible_keys
        if eligible_keys is None:
            raise ValueError(f"NOT is unsupported for discipline {context.discipline!r}: it declares no eligible keys")
        universe = await eligible_keys(session, context, grain)
        _require_uniform_arity([matching, universe], "NOT")
        return universe - matching

    # Leaf condition
    condition_type = condition.get("type")
    if not condition_type:
        logger.warning(f"Condition node missing 'type': {condition}")
        return set()

    params = condition.get("params", {})
    results = await execute_leaf(session, condition_type, params, context)
    expected = leaf_grain(condition_type, params if isinstance(params, dict) else None, discipline=context.discipline)
    if expected is not None:
        arity = GRAIN_ARITY[expected]
        if any(len(key) != arity for key in results):
            raise GrainMismatchError(f"{condition_type} must return {expected.value} keys of length {arity}")
    return results


def _require_uniform_arity(sets: list[ResultSet], op: str) -> None:
    arities = {len(key) for result in sets for key in result}
    if len(arities) > 1:
        raise GrainMismatchError(
            f"{op} cannot combine result keys of different grain (tuple lengths {sorted(arities)})"
        )
