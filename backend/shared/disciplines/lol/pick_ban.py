"""League of Legends' built-in pick/ban ruleset (``DisciplineSpec.pick_ban_presets``): side selection only.

The first actor chooses blue or red (``side_pick``; the item index is the side index of ``SPEC.sides``); later games
rotate the choice to the previous game's loser. No champion draft and no Fearless — D98 is narrowed to side
selection by the parent plan. Validates clean for ``kind="hero"`` ``mode="pool"``; ``test_pick_ban_rules_presets``
is the guard.
"""

from __future__ import annotations

from shared.domain.pick_ban_rules.presets import Preset
from shared.domain.pick_ban_rules.schema import parse_ruleset

SIDE_SELECTION = {
    "version": 2,
    "timer_seconds": 90,
    "on_timeout": "random_fill",
    "phases": [
        {
            "id": "side_selection",
            "name": "Side selection",
            "when": {},
            "pool_filter": {},
            "generator": None,
            "steps": [
                {
                    "id": "choose_side",
                    "action": "side_pick",
                    "actors": "first",
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
            ],
        }
    ],
}

PRESETS: tuple[Preset, ...] = (
    Preset(
        "lol_side_selection", "hero", ("pool",), parse_ruleset(SIDE_SELECTION), first_ban_rotation="result_loser_first"
    ),
)
