"""Deadlock's built-in pick/ban ruleset (``DisciplineSpec.pick_ban_presets``): per-game hero bans.

Each game: 2 bans per team, A-B-A-B, 30 s per turn, a random hero on timeout. The first ban rotates to the previous
game's loser (``result_loser_first``); game 1 is opened by the higher seed (bracket slot 1 when unseedable). No side
pick: ``SPEC.sides`` are labels only. Organizers edit count/order in the rules editor. Validates clean for
``kind="hero"`` ``mode="pool"``; ``test_pick_ban_rules_presets`` is the guard.
"""

from __future__ import annotations

from typing import Any

from shared.domain.pick_ban_rules.presets import Preset
from shared.domain.pick_ban_rules.schema import parse_ruleset


def _ban(step_id: str, actors: str) -> dict[str, Any]:
    return {
        "id": step_id,
        "action": "ban",
        "actors": actors,
        "count": 1,
        "min": None,
        "blind": False,
        "target": None,
        "lifetime": 1,
        "timer_seconds": None,
        "on_timeout": None,
        "dispute": {"enabled": False, "max": 0},
        "eligible": {},
        "constraints": [],
    }


HERO_BANS: dict[str, Any] = {
    "version": 2,
    "timer_seconds": 30,
    "on_timeout": "random_fill",
    "phases": [
        {
            "id": "main",
            "name": None,
            "when": {},
            "pool_filter": {},
            "generator": None,
            "steps": [_ban("ban1", "first"), _ban("ban2", "second"), _ban("ban3", "first"), _ban("ban4", "second")],
        }
    ],
}

PRESETS: tuple[Preset, ...] = (
    Preset("deadlock_hero_bans", "hero", ("pool",), parse_ruleset(HERO_BANS), first_ban_rotation="result_loser_first"),
)
