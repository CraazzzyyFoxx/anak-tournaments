"""The League of Legends module. Core reaches it only through ``shared.disciplines``."""

from __future__ import annotations

from collections.abc import Awaitable, Sequence
from typing import TYPE_CHECKING, Any

from shared.core.social import SocialProvider
from shared.disciplines.lol.ladder import NATIVE_LADDER
from shared.disciplines.spec import (
    DimensionSpec,
    DisciplineSpec,
    EventTypeSpec,
    FormatDimensionSpec,
    FormatRuleSpec,
    RoleSpec,
    StatDefSpec,
    TeamFormatPreset,
)

if TYPE_CHECKING:
    from pydantic import BaseModel
    from sqlalchemy.ext.asyncio import AsyncSession

    from shared.catalog_sync import CatalogImageMirror
    from shared.disciplines.spec import CollectionHandler
    from shared.domain.pick_ban_rules.presets import Preset
    from shared.models.identity.auth_user import AuthUser

__all__ = ("SPEC",)


async def _catalog_sync(session: AsyncSession, images: CatalogImageMirror) -> None:
    # Imported on call: the registry is imported by the pure pick-ban domain, which must not load repositories and an
    # HTTP client to answer "does this game have sides".
    from shared.disciplines.lol.catalog_sync import sync_catalog

    await sync_catalog(session, images)


def _pick_ban_presets() -> tuple[Preset, ...]:
    # Imported on call: the preset parses its ruleset through the pick-ban domain, which imports this registry.
    from shared.disciplines.lol.pick_ban import PRESETS

    return PRESETS


async def _native_ranks(session: AsyncSession, user_ids: Sequence[int]) -> dict[int, dict[str, int]]:
    # Imported on call: the snapshot read loads models the pure domain must not.
    from shared.disciplines.lol.ranks import native_ranks

    return await native_ranks(session, user_ids)


def _native_rank_rows(members: Any, game: str) -> Any:
    from shared.disciplines.lol.ranks import latest_rank_rows

    return latest_rank_rows(members, game)


#: The collection RPCs the collector serves (``handlers.HANDLERS`` holds the bodies) — Overwatch's set.
_COLLECTION_HANDLERS = (
    "rank.user_history",
    "rank.game_account_history",
    "rank.user_current",
    "rank.fetch_log",
    "rank.stats",
    "rank.user_collection",
    "rank.collect",
    "rank.reenable_disabled",
)


def _configure_runtime(broker: Any, *, session_factory: Any, redis: Any) -> None:
    from shared.disciplines.lol import collector

    collector.configure(session_factory=session_factory, redis=redis, broker=broker)


def _register_jobs(broker: Any, *, session_factory: Any, redis: Any, logger: Any) -> None:
    # Imported on call: the collector pulls in the broker, an HTTP client and the scheduler.
    from shared.disciplines.lol.jobs import register_jobs

    register_jobs(broker, session_factory=session_factory, redis=redis, logger=logger)


async def _start_jobs(*, session_factory: Any, redis: Any, logger: Any) -> None:
    from shared.disciplines.lol.jobs import start_jobs

    await start_jobs(session_factory=session_factory, redis=redis, logger=logger)


def _stop_jobs() -> Awaitable[None]:
    from shared.disciplines.lol.jobs import stop_jobs

    return stop_jobs()


def _collection_handler(name: str) -> CollectionHandler:
    async def handle(session: AsyncSession, user: AuthUser | None, data: dict[str, Any]) -> object:
        from shared.disciplines.lol.handlers import HANDLERS

        return await HANDLERS[name](session, user, data)

    return handle


def _settings_schema(key: str) -> type[BaseModel] | None:
    # Imported on call, like the jobs: the collector's config sits beside its broker queues and HTTP client.
    from shared.disciplines.lol import collector

    return collector.LolRankCollectionConfig if key == collector.SETTINGS_KEY else None


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

#: "по позициям" (each position 1..1) and "без ролей".
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
    #: Index 0 = blue, 1 = red: the ``side_pick`` wire index.
    sides=("blue", "red"),
    kinds={"character": "Champion", "map": "Map"},
    #: Data Dragon champion tags; a champion's class is its first tag.
    character_classes=("Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"),
    catalog_sync=_catalog_sync,
    native_ranks=_native_ranks,
    native_ladder=NATIVE_LADDER,
    native_rank_rows=_native_rank_rows,
    configure_runtime=_configure_runtime,
    register_jobs=_register_jobs,
    start_jobs=_start_jobs,
    stop_jobs=_stop_jobs,
    collection_handlers={name: _collection_handler(name) for name in _COLLECTION_HANDLERS},
    settings_schema=_settings_schema,
    dimensions=(POSITION,),
    team_format_presets=(POSITIONS_5V5, OPEN_5V5),
    identity_provider=SocialProvider.RIOT,
    short_name="LoL",
    #: Riot brand portal, LoL_Icon_Flat_Gold.
    icon="assets/lol/icon.svg",
    stat_defs=(StatDefSpec("kills", "Kills"), StatDefSpec("dragons", "Dragons")),
    event_types=(EventTypeSpec("kill", "Kill"),),
    pick_ban_presets=_pick_ban_presets,
)
