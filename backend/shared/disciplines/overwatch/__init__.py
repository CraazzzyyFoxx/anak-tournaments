"""The Overwatch module (D83). Core reaches it only through ``shared.disciplines``."""

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
    from shared.disciplines.overwatch.catalog_sync import sync_catalog

    await sync_catalog(session, images)


PLAYER_ROLE = DimensionSpec(
    "player_role",
    "Role",
    "single",
    True,
    (RoleSpec("tank", "Tank"), RoleSpec("damage", "Damage"), RoleSpec("support", "Support")),
)

#: Today's built-in 5v5 (ex ``DEFAULT_ROSTER_SLOTS``): one tank, two damage, two support, hard.
ROLE_QUEUE_5V5 = TeamFormatPreset(
    "role_queue_5v5",
    "5v5 role queue",
    5,
    5,
    dimensions=(FormatDimensionSpec("player_role", "enforced"),),
    rules=(
        FormatRuleSpec("player_role", "tank", hard_min=1, hard_max=1),
        FormatRuleSpec("player_role", "damage", hard_min=2, hard_max=2),
        FormatRuleSpec("player_role", "support", hard_min=2, hard_max=2),
    ),
)


SPEC = DisciplineSpec(
    "overwatch",
    "Overwatch",
    # A map is played attack/defence per round, not per team: no sides.
    (),
    kinds={"character": "Hero", "map": "Map", "mode": "Mode"},
    # Never "flex": flex is a slot without a constraint (D86), not a hero's class.
    character_classes=("tank", "damage", "support"),
    catalog_sync=_catalog_sync,
    dimensions=(PLAYER_ROLE,),
    team_format_presets=(ROLE_QUEUE_5V5,),
)
