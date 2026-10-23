"""The VALORANT module. Core reaches it only through ``shared.disciplines``.

No rank collector, match decoder or match fetcher: Riot's VALORANT API needs a production key and RSO opt-in, so
organizers enter ranks on the static native ladder.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from shared.core.social import SocialProvider
from shared.disciplines.spec import DimensionSpec, DisciplineSpec, FormatDimensionSpec, RoleSpec, TeamFormatPreset
from shared.disciplines.valorant.ladder import NATIVE_LADDER

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.catalog_sync import CatalogImageMirror, CatalogSyncProgress
    from shared.domain.pick_ban_rules.presets import Preset

__all__ = ("SPEC",)


async def _catalog_sync(session: AsyncSession, images: CatalogImageMirror, progress: CatalogSyncProgress) -> None:
    # Imported on call: the registry is imported by the pure pick-ban domain, which must not load repositories and an
    # HTTP client to answer "does this game have sides".
    from shared.disciplines.valorant.catalog_sync import sync_catalog

    await sync_catalog(session, images, progress)


def _pick_ban_presets() -> tuple[Preset, ...]:
    # Imported on call: the preset parses its ruleset through the pick-ban domain, which imports this registry.
    from shared.disciplines.valorant.pick_ban import PRESETS

    return PRESETS


#: One rank per account, as VALORANT's own ranked queue (no role queue): one rated dimension with one role, no open slot.
#: Deadlock's one-role code: a one-role game names no role anywhere in the UI, and ``player`` is core vocabulary (D99).
AGENT = DimensionSpec("agent", "Agent", "single", True, (RoleSpec("agent", "Agent"),))
OPEN_5V5 = TeamFormatPreset("open_5v5", "5v5", 5, 5, dimensions=(FormatDimensionSpec("agent", "off"),))


SPEC = DisciplineSpec(
    "valorant",
    "VALORANT",
    #: Index 0 = attackers, 1 = defenders: the ``side_pick`` wire index.
    sides=("attack", "defense"),
    kinds={"character": "Agent", "map": "Map"},
    #: valorant-api agent ``role``, lower-cased.
    character_classes=("duelist", "initiator", "controller", "sentinel"),
    catalog_sync=_catalog_sync,
    native_ladder=NATIVE_LADDER,
    dimensions=(AGENT,),
    team_format_presets=(OPEN_5V5,),
    flex=False,
    identity_provider=SocialProvider.RIOT,
    short_name="VAL",
    #: Published from frontend/public/disciplines/valorant/icon.svg (scripts/publish_discipline_assets.py).
    icon="assets/valorant/icon.svg",
    pick_ban_presets=_pick_ban_presets,
)
