"""The League of Legends module (D83, D98). Core reaches it only through ``shared.disciplines``."""

from __future__ import annotations

from shared.disciplines.spec import DisciplineSpec

__all__ = ("SPEC",)

SPEC = DisciplineSpec(
    "lol",
    "League of Legends",
    kinds={"character": "Champion", "map": "Map"},
    #: Data Dragon champion tags; a champion's class is its first tag.
    character_classes=("Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"),
)
