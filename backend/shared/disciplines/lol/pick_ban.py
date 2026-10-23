"""League of Legends' built-in pick/ban rulesets (``DisciplineSpec.pick_ban_presets``).

``lol_side_selection``: the first actor chooses blue or red (``side_pick``; the item index is the side index of
``SPEC.sides``); later games rotate the choice to the previous game's loser. ``lol_draft`` and ``lol_captains``
(pickup mixes only, spec §11.6 R4-7): the side pick, then the tournament draft order -- each pick by the next player
of the team in position order, or by the captain for the team followed by an assignment. Each validates clean for
``kind="hero"`` ``mode="pool"`` (the draft presets as a mix's); ``test_pick_ban_rules_presets`` is the guard.
"""

from __future__ import annotations

from typing import Any

from shared.domain.pick_ban_rules.presets import Preset
from shared.domain.pick_ban_rules.schema import parse_ruleset

SIDE_SELECTION: dict[str, Any] = {
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

#: The tournament draft after the side pick, as ``(action, side)``: bans B R B R B R, picks B R R B B R, bans R B R B,
#: picks R B B R (spec §11.6 R4-7).
_DRAFT_ORDER: tuple[tuple[str, str], ...] = (
    *(("ban", side) for side in ("blue", "red", "blue", "red", "blue", "red")),
    *(("pick", side) for side in ("blue", "red", "red", "blue", "blue", "red")),
    *(("ban", side) for side in ("red", "blue", "red", "blue")),
    *(("pick", side) for side in ("red", "blue", "blue", "red")),
)


def _step(step_id: str, action: str, actors: str, *, member: str | None = None) -> dict[str, Any]:
    return {
        "id": step_id,
        "action": action,
        "actors": actors,
        "count": 1,
        "min": None,
        "blind": False,
        "target": None,
        "lifetime": 1 if action == "ban" else None,
        "timer_seconds": None,
        "on_timeout": None,
        "dispute": {"enabled": False, "max": 0},
        "eligible": {},
        "constraints": [],
        "member": member,
    }


def _draft(*, member: str | None, tail: tuple[dict[str, Any], ...] = ()) -> dict[str, Any]:
    side = {**SIDE_SELECTION["phases"][0]["steps"][0], "timer_seconds": 60}
    steps = [
        _step(f"{action}{index}", action, f"side:{code}", member=member if action == "pick" else None)
        for index, (action, code) in enumerate(_DRAFT_ORDER, start=1)
    ]
    return {
        "version": 2,
        "timer_seconds": 30,
        "on_timeout": "random_fill",
        "phases": [
            {
                "id": "draft",
                "name": "Draft",
                "when": {},
                "pool_filter": {},
                "generator": None,
                "steps": [side, *steps, *tail],
            }
        ],
    }


#: Model (a): every pick is the next player's of that team, in position order.
LOL_DRAFT = _draft(member="next")
#: Model (c): the captain picks for the team, then gives each player one of the team's five heroes.
LOL_CAPTAINS = _draft(member=None, tail=({**_step("assign", "assign", "both"), "count": 5, "timer_seconds": 90},))

PRESETS: tuple[Preset, ...] = (
    Preset(
        "lol_side_selection", "hero", ("pool",), parse_ruleset(SIDE_SELECTION), first_ban_rotation="result_loser_first"
    ),
    Preset("lol_draft", "hero", ("pool",), parse_ruleset(LOL_DRAFT), first_ban_rotation="result_loser_first"),
    Preset("lol_captains", "hero", ("pool",), parse_ruleset(LOL_CAPTAINS), first_ban_rotation="result_loser_first"),
)
