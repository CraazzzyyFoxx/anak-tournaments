"""The Overwatch module (D83). Core reaches it only through ``shared.disciplines``."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

from shared.core.social import SocialProvider
from shared.disciplines.overwatch.ladder import NATIVE_LADDER
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


async def _native_ranks(session: AsyncSession, user_ids: Sequence[int]) -> dict[int, dict[str, int]]:
    # Imported on call, like the catalog sync: the snapshot read loads models the pure domain must not.
    from shared.disciplines.overwatch.ranks import native_ranks

    return await native_ranks(session, user_ids)


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
    native_ranks=_native_ranks,
    native_ladder=NATIVE_LADDER,
    dimensions=(PLAYER_ROLE,),
    team_format_presets=(ROLE_QUEUE_5V5,),
    identity_provider=SocialProvider.BATTLENET,
)
