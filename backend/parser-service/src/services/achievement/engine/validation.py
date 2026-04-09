"""Condition tree validation: structure, types, grain compatibility."""

from __future__ import annotations

from typing import Any

from shared.models.achievement import AchievementGrain

from .conditions import get_registered_types

# Grain produced by each leaf condition type.
LEAF_GRAINS: dict[str, AchievementGrain] = {
    # Match grain
    "stat_threshold": AchievementGrain.user_match,
    "match_criteria": AchievementGrain.user_match,
    "match_win": AchievementGrain.user_match,
    "hero_stat": AchievementGrain.user_match,
    "match_mvp_check": AchievementGrain.user_match,
    # Tournament grain
    "standing_position": AchievementGrain.user_tournament,
    "standing_record": AchievementGrain.user_tournament,
    "div_change": AchievementGrain.user_tournament,
    "div_level": AchievementGrain.user_tournament,
    "is_captain": AchievementGrain.user_tournament,
    "is_newcomer": AchievementGrain.user_tournament,
    "tournament_type": AchievementGrain.user_tournament,
    "hero_kd_best": AchievementGrain.user_tournament,
    "team_players_match": AchievementGrain.user_tournament,
    "captain_property": AchievementGrain.user_tournament,
    "encounter_score": AchievementGrain.user_tournament,
    "encounter_revenge": AchievementGrain.user_tournament,
    "bracket_path": AchievementGrain.user_tournament,
    "tournament_format": AchievementGrain.user_tournament,
    "match_mvp_check": AchievementGrain.user_match,
    # Global grain
    "global_stat_sum": AchievementGrain.user,
    "tournament_count": AchievementGrain.user,
    "global_winrate": AchievementGrain.user,
    "distinct_count": AchievementGrain.user,  # can be user or user_tournament depending on scope
    "consecutive": AchievementGrain.user,
    "stable_streak": AchievementGrain.user,
}

# Grain ordering: finer grains are "larger" (more specific).
GRAIN_ORDER = {
    AchievementGrain.user: 0,
    AchievementGrain.user_tournament: 1,
    AchievementGrain.user_match: 2,
}


def validate_condition_tree(condition: dict[str, Any]) -> list[str]:
    """Validate a condition tree. Returns a list of error strings (empty = valid)."""
    errors: list[str] = []
    _validate_node(condition, errors, path="root")
    return errors


def infer_grain(condition: dict[str, Any]) -> AchievementGrain:
    """Infer the resulting grain of a condition tree."""
    grains = _collect_grains(condition)
    if not grains:
        return AchievementGrain.user
    # Return the finest (most specific) grain
    return max(grains, key=lambda g: GRAIN_ORDER[g])


def _validate_node(
    node: dict[str, Any],
    errors: list[str],
    path: str,
) -> None:
    if not isinstance(node, dict):
        errors.append(f"{path}: expected dict, got {type(node).__name__}")
        return

    # Empty dict is valid (no conditions yet)
    if not node:
        return

    # Logical operators
    for op in ("AND", "OR"):
        if op in node:
            children = node[op]
            if not isinstance(children, list) or len(children) < 1:
                errors.append(f"{path}.{op}: must be a non-empty list")
                return
            for i, child in enumerate(children):
                _validate_node(child, errors, f"{path}.{op}[{i}]")
            return

    if "NOT" in node:
        _validate_node(node["NOT"], errors, f"{path}.NOT")
        return

    # Leaf node
    ctype = node.get("type")
    if not ctype:
        errors.append(f"{path}: missing 'type' field")
        return

    registered = get_registered_types()
    # Also allow sub-condition types
    all_valid = registered + ["player_role", "player_flag", "player_div"]
    if ctype not in all_valid:
        errors.append(f"{path}: unknown condition type '{ctype}'")
        return

    params = node.get("params", {})
    if not isinstance(params, dict):
        errors.append(f"{path}.params: expected dict")
        return

    # Type-specific param validation
    _validate_leaf_params(ctype, params, errors, path)


def _validate_leaf_params(
    ctype: str,
    params: dict[str, Any],
    errors: list[str],
    path: str,
) -> None:
    """Validate params for a specific leaf type."""
    if ctype == "stat_threshold":
        _require_keys(params, ["stat", "op", "value"], errors, path)
    elif ctype == "match_criteria":
        _require_keys(params, ["field", "op", "value"], errors, path)
        if params.get("field") not in ("closeness", "match_time", "time"):
            errors.append(f"{path}.params.field: must be 'closeness', 'match_time', or 'time'")
    elif ctype == "match_win":
        pass  # no params needed
    elif ctype == "standing_position":
        _require_keys(params, ["op", "value"], errors, path)
    elif ctype == "standing_record":
        _require_keys(params, ["field", "op", "value"], errors, path)
    elif ctype == "div_change":
        _require_keys(params, ["direction", "min_shift"], errors, path)
        if params.get("direction") not in ("up", "down"):
            errors.append(f"{path}.params.direction: must be 'up' or 'down'")
    elif ctype == "div_level":
        _require_keys(params, ["op", "value"], errors, path)
    elif ctype == "team_players_match":
        _require_keys(params, ["mode", "condition"], errors, path)
        if params.get("mode") not in ("all", "any", "count"):
            errors.append(f"{path}.params.mode: must be 'all', 'any', or 'count'")
        if params.get("mode") == "count":
            _require_keys(params, ["count_op", "count_value"], errors, path)
        sub = params.get("condition")
        if sub:
            _validate_node(sub, errors, f"{path}.params.condition")
    elif ctype == "captain_property":
        _require_keys(params, ["condition"], errors, path)
        sub = params.get("condition")
        if sub:
            _validate_node(sub, errors, f"{path}.params.condition")
    elif ctype == "hero_kd_best":
        pass  # all params optional
    elif ctype == "hero_stat":
        _require_keys(params, ["hero_slug", "stat", "op", "value"], errors, path)
    elif ctype == "encounter_score":
        _require_keys(params, ["scores"], errors, path)
    elif ctype == "encounter_revenge":
        pass
    elif ctype == "global_stat_sum":
        _require_keys(params, ["stat", "op", "value"], errors, path)
    elif ctype == "global_winrate":
        pass  # flexible params
    elif ctype == "tournament_count":
        _require_keys(params, ["op", "value"], errors, path)
    elif ctype == "distinct_count":
        _require_keys(params, ["field", "op", "value"], errors, path)
    elif ctype == "consecutive":
        _require_keys(params, ["metric", "min_streak"], errors, path)
    elif ctype == "stable_streak":
        _require_keys(params, ["fields", "min_streak"], errors, path)
    elif ctype == "player_role":
        _require_keys(params, ["role"], errors, path)
    elif ctype == "player_flag":
        _require_keys(params, ["flag"], errors, path)
    elif ctype == "player_div":
        _require_keys(params, ["op", "value"], errors, path)


def _require_keys(
    params: dict[str, Any],
    keys: list[str],
    errors: list[str],
    path: str,
) -> None:
    for key in keys:
        if key not in params:
            errors.append(f"{path}.params: missing required key '{key}'")


def _collect_grains(node: dict[str, Any]) -> list[AchievementGrain]:
    """Recursively collect grain levels from all leaf nodes."""
    grains = []

    for op in ("AND", "OR"):
        if op in node:
            for child in node[op]:
                grains.extend(_collect_grains(child))
            return grains

    if "NOT" in node:
        return _collect_grains(node["NOT"])

    ctype = node.get("type")
    if ctype and ctype in LEAF_GRAINS:
        grains.append(LEAF_GRAINS[ctype])

    return grains
