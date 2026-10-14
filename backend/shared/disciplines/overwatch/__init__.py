"""The Overwatch module (D83). Core reaches it only through ``shared.disciplines``."""

from __future__ import annotations

from shared.disciplines.spec import DisciplineSpec

__all__ = ("SPEC",)

SPEC = DisciplineSpec(
    "overwatch",
    "Overwatch",
    # A map is played attack/defence per round, not per team: no sides.
    (),
    kinds={"character": "Hero", "map": "Map", "mode": "Mode"},
    # Never "flex": that is a roster role a player holds, not a hero's class (migration ``heroflex0001``).
    character_classes=("tank", "damage", "support"),
)
