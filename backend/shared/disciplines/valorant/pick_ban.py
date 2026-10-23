"""VALORANT's built-in pick/ban ruleset (``DisciplineSpec.pick_ban_presets``): the VCT Bo1 map veto.

Seven-map pool: A-B-A-B-A-B bans leave one map, and A (the team that did not ban last) picks its starting side. The
engine needs the ``decider`` last, so the side pick comes before it; the map is already settled by then. Bo1 only
(``best_of == 1``): a flat map pool writes every side pick to game 1, so a Bo3 with a side per map is not expressible
here. Validates clean for ``kind="map"`` ``mode="pool"``; ``test_pick_ban_rules_presets`` is the guard.
"""

from __future__ import annotations

from typing import Any

from shared.domain.pick_ban_rules.presets import Preset
from shared.domain.pick_ban_rules.schema import parse_ruleset


def _step(step_id: str, action: str, actors: str) -> dict[str, Any]:
    return {
        "id": step_id,
        "action": action,
        "actors": actors,
        "count": 1,
        "min": None,
        "blind": False,
        "target": None,
        "lifetime": None,
        "timer_seconds": None,
        "on_timeout": None,
        "dispute": {"enabled": False, "max": 0},
        "eligible": {},
        "constraints": [],
    }


VCT_BO1: dict[str, Any] = {
    "version": 2,
    "timer_seconds": 60,
    "on_timeout": "random_fill",
    "phases": [
        {
            "id": "bo1",
            "name": None,
            "when": {"type": "best_of", "params": {"op": "==", "value": 1}},
            "pool_filter": {},
            "generator": None,
            "steps": [
                *(_step(f"ban{n}", "ban", "first" if n % 2 else "second") for n in range(1, 7)),
                _step("side", "side_pick", "first"),
                _step("decider", "decider", "system"),
            ],
        }
    ],
}

PRESETS: tuple[Preset, ...] = (Preset("valorant_vct_bo1", "map", ("pool",), parse_ruleset(VCT_BO1)),)
