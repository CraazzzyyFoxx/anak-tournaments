"""The League of Legends module (D83, D98). Core reaches it only through ``shared.disciplines``."""

from __future__ import annotations

from typing import TYPE_CHECKING

from shared.disciplines.spec import (
    DimensionSpec,
    DisciplineSpec,
    FormatDimensionSpec,
    FormatRuleSpec,
    RoleSpec,
    TeamFormatPreset,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.catalog_sync import CatalogImageMirror

__all__ = ("SPEC",)


async def _catalog_sync(session: AsyncSession, images: CatalogImageMirror) -> None:
    # Imported on call: the registry is imported by the pure pick-ban domain, which must not load repositories and an
    # HTTP client to answer "does this game have sides".
    from shared.disciplines.lol.catalog_sync import sync_catalog

    await sync_catalog(session, images)


POSITION = DimensionSpec(
    "position",
    "Position",
    "single",
    True,
    (
        RoleSpec("top", "Top"),
        RoleSpec("jungle", "Jungle"),
        RoleSpec("mid", "Mid"),
        RoleSpec("bot", "Bot"),
        RoleSpec("support", "Support"),
    ),
)

#: D98: "по позициям" (each position 1..1) and "без ролей".
POSITIONS_5V5 = TeamFormatPreset(
    "positions_5v5",
    "5v5 by positions",
    5,
    5,
    dimensions=(FormatDimensionSpec("position", "enforced"),),
    rules=tuple(FormatRuleSpec("position", role.code, hard_min=1, hard_max=1) for role in POSITION.roles),
)
OPEN_5V5 = TeamFormatPreset("open_5v5", "5v5 without roles", 5, 5, dimensions=(FormatDimensionSpec("position", "off"),))


SPEC = DisciplineSpec(
    "lol",
    "League of Legends",
    kinds={"character": "Champion", "map": "Map"},
    #: Data Dragon champion tags; a champion's class is its first tag.
    character_classes=("Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"),
    catalog_sync=_catalog_sync,
    dimensions=(POSITION,),
    team_format_presets=(POSITIONS_5V5, OPEN_5V5),
)
