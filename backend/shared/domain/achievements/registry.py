"""Leaf condition registry, one table per discipline.

Each leaf executor is an async function with signature:
    async def execute(session, params, context) -> ResultSet

Registration carries the node's whole contract — result grain, parameter names,
and the tables it reads. That contract is the single source the validator, the
``depends_on`` derivation and the admin editor's palette all read, so a node
cannot be added to one of them and forgotten in the others.

A condition belongs to the discipline that registered it: ``(discipline, name)`` is the key, so two games may use one
name for different queries and a game that registered nothing (LoL) advertises and executes nothing. A discipline's
module registers its conditions when its ``achievement_conditions`` hook first runs (``shared.disciplines``); every
lookup here runs that hook, which is idempotent, so a caller never has to remember to load a game first.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from shared.disciplines import discipline as _discipline
from shared.models.achievements.achievement import AchievementGrain

if TYPE_CHECKING:
    from shared.domain.achievements.context import EvalContext

ResultSet = set[tuple[int, ...]]

#: ``await executor(session, params, context)``; run by ``shared.services.achievements.evaluator``.
LeafExecutor = Callable[
    [Any, dict[str, Any], "EvalContext"],
    Coroutine[Any, Any, ResultSet],
]

GrainResolver = Callable[[dict[str, Any]], AchievementGrain]


@dataclass(frozen=True, slots=True)
class LeafSpec:
    """Everything about a condition node that is not its query."""

    name: str
    grain: AchievementGrain
    description: str
    required: tuple[str, ...] = ()
    optional: tuple[str, ...] = ()
    #: Source tables. A rule's ``depends_on`` is the union over its leaves, which
    #: is what decides whether a change event re-evaluates the rule at all.
    depends_on: tuple[str, ...] = ()
    #: Usable inside ``team_players_match`` / ``captain_property`` sub-trees.
    subcondition_ok: bool = False
    #: Only usable there — no standalone executor.
    subcondition_only: bool = False
    #: Grain depends on params (``distinct_count``'s scope, and friends).
    grain_for: GrainResolver | None = None
    #: The node's own value checks beyond required/optional keys (closed value sets, stat names, count companions).
    #: Returns messages relative to the node, e.g. ``"params.field: must be one of a, b"``; the tree path is prefixed.
    validate_params: Callable[[dict[str, Any]], list[str]] | None = None
    #: True when these params read divisions across grid versions, so the run needs a division-grid normalizer.
    requires_normalized_divisions: Callable[[dict[str, Any]], bool] | None = None

    def resolve_grain(self, params: dict[str, Any] | None = None) -> AchievementGrain:
        if self.grain_for is None:
            return self.grain
        return self.grain_for(params or {})


_REGISTRY: dict[tuple[str, str], LeafExecutor] = {}
_SPECS: dict[tuple[str, str], LeafSpec] = {}


def register(
    name: str,
    *,
    discipline: str,
    grain: AchievementGrain,
    description: str,
    required: tuple[str, ...] = (),
    optional: tuple[str, ...] = (),
    depends_on: tuple[str, ...] = (),
    subcondition_ok: bool = False,
    grain_for: GrainResolver | None = None,
    validate_params: Callable[[dict[str, Any]], list[str]] | None = None,
    requires_normalized_divisions: Callable[[dict[str, Any]], bool] | None = None,
) -> Callable[[LeafExecutor], LeafExecutor]:
    """Decorator to register a leaf condition executor and its contract under ``discipline``."""

    def decorator(fn: LeafExecutor) -> LeafExecutor:
        if (discipline, name) in _REGISTRY:
            raise ValueError(f"condition {name!r} is already registered for discipline {discipline!r}")
        register_spec(
            LeafSpec(
                name=name,
                grain=grain,
                description=description,
                required=required,
                optional=optional,
                depends_on=depends_on,
                subcondition_ok=subcondition_ok,
                grain_for=grain_for,
                validate_params=validate_params,
                requires_normalized_divisions=requires_normalized_divisions,
            ),
            discipline=discipline,
        )
        _REGISTRY[(discipline, name)] = fn
        return fn

    return decorator


def register_spec(spec: LeafSpec, *, discipline: str) -> LeafSpec:
    """Register a contract with no executor of its own (sub-condition predicates)."""
    if (discipline, spec.name) in _SPECS:
        raise ValueError(f"condition {spec.name!r} is already registered for discipline {discipline!r}")
    _SPECS[(discipline, spec.name)] = spec
    return spec


def _load(code: str) -> None:
    """Run ``code``'s ``achievement_conditions`` hook; a game without one has no conditions."""
    hook = _discipline(code).achievement_conditions
    if hook is not None:
        hook()


def get_spec(name: str, *, discipline: str) -> LeafSpec | None:
    _load(discipline)
    return _SPECS.get((discipline, name))


def get_specs(*, discipline: str) -> dict[str, LeafSpec]:
    """A copy of ``discipline``'s contracts by name."""
    _load(discipline)
    return {name: spec for (code, name), spec in _SPECS.items() if code == discipline}


def get_executor(condition_type: str, *, discipline: str) -> LeafExecutor:
    """The executor ``discipline`` registered for ``condition_type``; ``ValueError`` when there is none."""
    _load(discipline)
    executor = _REGISTRY.get((discipline, condition_type))
    if executor is None:
        raise ValueError(f"Unknown condition type {condition_type!r} for discipline {discipline!r}")
    return executor
