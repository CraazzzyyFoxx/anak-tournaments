"""The League of Legends module (D83, D98). Core reaches it only through ``shared.disciplines``."""

from __future__ import annotations

from typing import TYPE_CHECKING

from shared.disciplines.spec import DisciplineSpec

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.catalog_sync import CatalogImageMirror

__all__ = ("SPEC",)


async def _catalog_sync(session: AsyncSession, images: CatalogImageMirror) -> None:
    # Imported on call: the registry is imported by the pure pick-ban domain, which must not load repositories and an
    # HTTP client to answer "does this game have sides".
    from shared.disciplines.lol.catalog_sync import sync_catalog

    await sync_catalog(session, images)


SPEC = DisciplineSpec(
    "lol",
    "League of Legends",
    kinds={"character": "Champion", "map": "Map"},
    #: Data Dragon champion tags; a champion's class is its first tag.
    character_classes=("Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"),
    catalog_sync=_catalog_sync,
)
