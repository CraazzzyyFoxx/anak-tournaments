"""Built-in rulesets the constructor offers as a starting point.

Core owns the :class:`Preset` schema and the game-neutral map presets. A game's own rulesets (the character
bans that only make sense against its classes) are declared by its module through
``DisciplineSpec.pick_ban_presets`` and reach the constructor through :func:`presets_for`.

Each preset validates clean for its own kind and modes — ``test_pick_ban_rules_presets`` is the guard, so a preset
can never ship an unsavable ruleset.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from shared.core.enums import FirstBanRotation

from .schema import Ruleset, parse_ruleset


class UnknownDiscipline(LookupError):
    """A discipline code no installed module declares; never answered with another game's presets."""


@dataclass(frozen=True, slots=True)
class Preset:
    id: str
    kind: str
    #: Pool modes the preset fits (``pool``/``slots``).
    modes: tuple[str, ...]
    ruleset: Ruleset
    #: The ``PickBanConfig.first_ban_rotation`` value the preset needs, or ``None`` when it leaves the organizer's
    #: rotation alone. The rotation lives outside the ruleset document.
    first_ban_rotation: str | None = None

    def __post_init__(self) -> None:
        if self.first_ban_rotation is not None:
            FirstBanRotation(self.first_ban_rotation)  # ValueError on a spelling the config column rejects

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "modes": list(self.modes),
            "ruleset": self.ruleset.to_json(),
            "first_ban_rotation": self.first_ban_rotation,
        }


MAP_BRACKET: dict[str, Any] = {
    "version": 2,
    "timer_seconds": 60,
    "on_timeout": "random_fill",
    "phases": [{"id": "main", "name": None, "when": {}, "pool_filter": {}, "generator": "bracket", "steps": []}],
}

MAP_SLOT_VETO: dict[str, Any] = {
    "version": 2,
    "timer_seconds": 60,
    "on_timeout": "random_fill",
    "phases": [{"id": "main", "name": None, "when": {}, "pool_filter": {}, "generator": "slot_veto", "steps": []}],
}

#: The presets every game gets: a map pool needs no game-specific vocabulary.
GENERIC_PRESETS: tuple[Preset, ...] = (
    Preset("map_bracket", "map", ("pool",), parse_ruleset(MAP_BRACKET)),
    Preset("map_slot_veto", "map", ("slots",), parse_ruleset(MAP_SLOT_VETO)),
)

GENERIC_PRESETS_BY_ID: dict[str, Preset] = {preset.id: preset for preset in GENERIC_PRESETS}


def presets_for(discipline: str) -> tuple[Preset, ...]:
    """The presets an organizer of ``discipline`` may start from: that module's own, then the generic ones.

    Raises :class:`UnknownDiscipline` for a code no installed module declares, and ``ValueError`` when a module
    declares an id twice or one that shadows a generic preset.
    """
    # Imported on call: ``shared.disciplines`` loads the game modules, which import this package's schema.
    from shared.disciplines import DISCIPLINES

    spec = DISCIPLINES.get(discipline)
    if spec is None:
        raise UnknownDiscipline(discipline)
    own = spec.pick_ban_presets() if spec.pick_ban_presets is not None else ()
    presets = (*own, *GENERIC_PRESETS)
    ids = [preset.id for preset in presets]
    if len(set(ids)) != len(ids):
        raise ValueError(f"discipline {discipline!r} declares a pick-ban preset id more than once: {sorted(ids)}")
    return presets
