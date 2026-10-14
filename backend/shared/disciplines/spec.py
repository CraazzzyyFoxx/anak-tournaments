"""What the code knows about a discipline, beside what the DB stores (D25, D48, D83, D101).

Pure data, no DB: the pick-ban engine, the ruleset validator and the game writer all read it, and none of them may do
IO to answer "does this game have sides".
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.catalog_sync import CatalogImageMirror

#: Pull the module's catalog source into ``catalog.entity`` (commits itself).
CatalogSync = Callable[["AsyncSession", "CatalogImageMirror"], Awaitable[None]]

__all__ = ("CATALOG_KINDS", "CatalogSync", "DisciplineSpec")

#: The core's catalog vocabulary (D101): ``catalog.entity.kind`` and every kind-constant column spell these and
#: nothing else. What a kind is called in a game's UI is the module's label, not a new kind.
CATALOG_KINDS: tuple[str, ...] = ("character", "map", "mode")


@dataclass(frozen=True, slots=True)
class DisciplineSpec:
    code: str
    name: str
    #: Side codes a game of this discipline starts on, in declaration order; ``()`` when the game has no sides. A
    #: ``side_pick`` step is legal only when this has exactly as many entries as the game has participants.
    sides: tuple[str, ...] = ()
    #: The catalog kinds this game has, each with its UI label ("Hero", "Champion").
    kinds: dict[str, str] = field(default_factory=dict, hash=False)
    #: Allowed ``attrs.class`` values of a ``character``; ``()`` leaves the class unchecked.
    character_classes: tuple[str, ...] = ()
    catalog_sync: CatalogSync | None = field(default=None, compare=False)
