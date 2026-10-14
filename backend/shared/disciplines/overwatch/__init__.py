"""The Overwatch module (D83). Core reaches it only through ``shared.disciplines``."""

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
    from shared.disciplines.overwatch.catalog_sync import sync_catalog

    await sync_catalog(session, images)


SPEC = DisciplineSpec(
    "overwatch",
    "Overwatch",
    # A map is played attack/defence per round, not per team: no sides.
    (),
    kinds={"character": "Hero", "map": "Map", "mode": "Mode"},
    # Never "flex": that is a roster role a player holds, not a hero's class (migration ``heroflex0001``).
    character_classes=("tank", "damage", "support"),
    catalog_sync=_catalog_sync,
)
