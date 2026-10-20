"""The achievement kernel's registry is one table per discipline (P6 task 1).

Two throwaway disciplines register the same condition names with different executors, grains and tables; Overwatch
registers its real conditions through its lazy hook; LoL declares none and so advertises and executes none.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
import textwrap
from typing import Any

import pytest

from shared.disciplines import DISCIPLINES
from shared.domain.achievements import registry
from shared.domain.achievements.context import EvalContext
from shared.domain.achievements.registry import LeafSpec, get_spec, get_specs, register, register_spec
from shared.domain.achievements.validation import (
    derive_depends_on,
    infer_grain,
    requires_normalized_divisions,
    validate_condition_tree,
    validate_rule_definition,
)
from shared.models.achievements.achievement import AchievementGrain
from shared.services.achievements.evaluator import GrainMismatchError, evaluate, execute_leaf

A, B = "registry-test-a", "registry-test-b"


def _keys(*keys: tuple[int, ...]):
    async def execute(session: Any, params: dict[str, Any], context: EvalContext) -> set[tuple[int, ...]]:
        return set(keys)

    return execute


# Same name, different contract per discipline. Registered once at import: a duplicate raises.
register("probe", discipline=A, grain=AchievementGrain.user, description="A probe", depends_on=("a.table",))(
    _keys((1,))
)
register(
    "probe",
    discipline=B,
    grain=AchievementGrain.user_tournament,
    description="B probe",
    required=("n",),
    depends_on=("b.table",),
    validate_params=lambda params: [] if params.get("n", 0) > 0 else ["params.n: must be positive"],
    requires_normalized_divisions=lambda params: params.get("n") == 2,
)(_keys((1, 10)))
# user_encounter and user_match are both 3-tuples: arity cannot tell them apart, grain can.
register("encounter_leaf", discipline=A, grain=AchievementGrain.user_encounter, description="E")(_keys((1, 2, 3)))
register("match_leaf", discipline=A, grain=AchievementGrain.user_match, description="M")(_keys((1, 2, 3)))
register_spec(
    LeafSpec(
        "sub_only", AchievementGrain.user, "Sub", subcondition_only=True, subcondition_ok=True, depends_on=("a.sub",)
    ),
    discipline=A,
)
register(
    "needs_div",
    discipline=A,
    grain=AchievementGrain.user,
    description="D",
    requires_normalized_divisions=lambda _: True,
)(_keys())
register("wrapper", discipline=A, grain=AchievementGrain.user, description="W", required=("condition",))(_keys())


def _context(discipline: str) -> EvalContext:
    return EvalContext(workspace_id=1, discipline=discipline)


def test_same_name_has_independent_spec_grain_and_dependencies() -> None:
    a, b = get_spec("probe", discipline=A), get_spec("probe", discipline=B)
    assert (a.grain, b.grain) == (AchievementGrain.user, AchievementGrain.user_tournament)
    assert (a.depends_on, b.depends_on) == (("a.table",), ("b.table",))
    assert infer_grain({"type": "probe", "params": {"n": 1}}, discipline=B) is AchievementGrain.user_tournament
    assert infer_grain({"type": "probe"}, discipline=A) is AchievementGrain.user
    assert derive_depends_on({"AND": [{"type": "probe"}]}, discipline=A) == ["a.table"]
    assert derive_depends_on({"AND": [{"type": "probe"}]}, discipline=B) == ["b.table"]


def test_same_name_executes_the_disciplines_own_executor() -> None:
    assert asyncio.run(execute_leaf(None, "probe", {}, _context(A))) == {(1,)}
    assert asyncio.run(execute_leaf(None, "probe", {}, _context(B))) == {(1, 10)}


def test_a_duplicate_registration_raises_instead_of_replacing() -> None:
    with pytest.raises(ValueError, match="already registered"):
        register("probe", discipline=A, grain=AchievementGrain.user, description="again")(_keys())
    assert asyncio.run(execute_leaf(None, "probe", {}, _context(A))) == {(1,)}
    with pytest.raises(ValueError, match="already registered"):
        register_spec(LeafSpec("sub_only", AchievementGrain.user, "again"), discipline=A)


def test_unknown_discipline_and_lol_have_no_conditions() -> None:
    assert DISCIPLINES["lol"].achievement_conditions is None
    for code in ("lol", "no-such-game"):
        assert get_specs(discipline=code) == {}
        assert registry.get_registered_types(discipline=code) == []
        assert validate_condition_tree({"type": "match_win"}, discipline=code) == [
            "root: unknown condition type 'match_win'"
        ]
        errors, grain = validate_rule_definition({"type": "match_win"}, None, discipline=code)
        assert errors and grain is None
        with pytest.raises(ValueError, match="Unknown condition type"):
            asyncio.run(execute_leaf(None, "match_win", {}, _context(code)))
    # A name registered for another game is not inherited.
    assert validate_condition_tree({"type": "probe"}, discipline="lol")


def test_returned_metadata_is_a_copy() -> None:
    specs = get_specs(discipline=A)
    specs.pop("probe")
    specs["injected"] = LeafSpec("injected", AchievementGrain.user, "x")
    assert "probe" in get_specs(discipline=A)
    assert "injected" not in get_specs(discipline=A)
    with pytest.raises(AttributeError):
        get_spec("probe", discipline=A).name = "renamed"  # type: ignore[misc]


def test_overwatch_loads_lazily_and_repeated_loading_is_stable() -> None:
    first = get_specs(discipline="overwatch")
    executors = {
        name: registry._REGISTRY[("overwatch", name)] for name in registry.get_registered_types(discipline="overwatch")
    }
    DISCIPLINES["overwatch"].achievement_conditions()
    DISCIPLINES["overwatch"].achievement_conditions()
    assert set(get_specs(discipline="overwatch")) == set(first)
    assert executors == {name: registry._REGISTRY[("overwatch", name)] for name in executors}
    # Overwatch's own names stay out of the test disciplines and out of LoL.
    assert "match_win" in first and "match_win" not in get_specs(discipline=A)
    assert get_spec("match_win", discipline="lol") is None


def test_value_checks_and_normalization_come_from_the_registration() -> None:
    assert validate_condition_tree({"type": "probe", "params": {"n": 0}}, discipline=B) == [
        "root.params.n: must be positive"
    ]
    assert validate_condition_tree({"type": "probe", "params": {"n": 1}}, discipline=B) == []
    assert requires_normalized_divisions({"NOT": {"type": "probe", "params": {"n": 2}}}, discipline=B) is True
    assert requires_normalized_divisions({"type": "probe", "params": {"n": 1}}, discipline=B) is False
    # Sub-condition trees are traversed by the generic walker.
    assert requires_normalized_divisions(
        {"type": "wrapper", "params": {"condition": {"type": "needs_div"}}}, discipline=A
    )
    assert not requires_normalized_divisions(
        {"type": "wrapper", "params": {"condition": {"type": "probe"}}}, discipline=A
    )
    assert requires_normalized_divisions({"type": "wrapper"}, discipline="lol") is False


def test_equal_arity_different_grain_is_rejected() -> None:
    tree = {"AND": [{"type": "encounter_leaf"}, {"type": "match_leaf"}]}
    errors = validate_condition_tree(tree, discipline=A)
    assert any("mixed result grains" in error for error in errors)
    assert any("mixed result grains" in error for error in validate_condition_tree({"NOT": tree}, discipline=A))
    with pytest.raises(GrainMismatchError):
        # A 3-key leaf cannot be combined with a 1-key leaf, whatever the declared grains.
        asyncio.run(evaluate(None, {"AND": [{"type": "encounter_leaf"}, {"type": "probe"}]}, _context(A)))


def test_nested_boolean_trees_evaluate_per_discipline() -> None:
    tree = {"OR": [{"AND": [{"type": "probe"}, {"type": "probe"}]}, {"AND": []}]}
    assert asyncio.run(evaluate(None, tree, _context(A))) == {(1,)}
    assert asyncio.run(evaluate(None, {"AND": [{"type": "probe", "params": {"n": 1}}]}, _context(B))) == {(1, 10)}


def test_not_without_an_eligibility_hook_is_unsupported_not_everyone() -> None:
    assert DISCIPLINES["lol"].achievement_eligible_keys is None
    with pytest.raises(ValueError, match="declares no eligible keys"):
        asyncio.run(evaluate(None, {"NOT": {"type": "probe"}}, _context(A)))


def test_importing_the_registry_loads_no_game_or_analytics_code() -> None:
    code = textwrap.dedent(
        """
        import sys
        import shared.disciplines
        import shared.domain.achievements.registry
        shared.disciplines.discipline("overwatch").achievement_conditions()
        loaded = sorted(m for m in sys.modules if m.split(".")[0] in {"pandas", "numpy", "sklearn", "torch", "xgboost", "src"})
        analytics = sorted(m for m in sys.modules if m.startswith("shared.disciplines.overwatch.analytics"))
        assert loaded == [] and analytics == [], (loaded, analytics)
        """
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
