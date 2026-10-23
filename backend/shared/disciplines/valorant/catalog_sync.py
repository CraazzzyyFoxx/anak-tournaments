"""VALORANT's catalog source: valorant-api.com (public, no key).

Agents (``isPlayableCharacter``): code = the slugified display name (``kay-o`` for KAY/O), class = the lower-cased role
(Duelist, Initiator, Controller, Sentinel). Maps: only the bomb-site maps (a ``tacticalDescription`` such as "A/B
Sites"); Team Deathmatch, Skirmish, the Range and Basic Training are not 5v5 tournament maps. A new map starts in the
competitive pool, as Overwatch's; the API does not know the season's pool, so organizers curate
``attrs.in_competitive``. Every valorant-api read happens before the first catalog write.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import slugify
from shared.catalog_sync import CatalogImageMirror, CatalogSyncProgress, SourceEntity, apply_source, fetch_json
from shared.clients.http_client import ResilientHttpClient

__all__ = ("VALORANT_API", "agent_rows", "map_rows", "sync_catalog")

DISCIPLINE = "valorant"
VALORANT_API = "https://valorant-api.com"


def agent_rows(agents: list[dict[str, Any]]) -> list[SourceEntity]:
    return [
        SourceEntity(
            slug=slugify(agent["displayName"]),
            name=agent["displayName"],
            image_url=agent["displayIcon"],
            attrs={"class": agent["role"]["displayName"].lower()},
        )
        for agent in agents
        if agent.get("isPlayableCharacter") and agent.get("role")
    ]


def map_rows(maps: list[dict[str, Any]]) -> list[SourceEntity]:
    return [
        SourceEntity(
            slug=slugify(game_map["displayName"]),
            name=game_map["displayName"],
            image_url=game_map["splash"],
            attrs={"in_competitive": True},
        )
        for game_map in maps
        if game_map.get("tacticalDescription") and game_map.get("splash")
    ]


async def sync_catalog(
    session: AsyncSession,
    images: CatalogImageMirror,
    progress: CatalogSyncProgress,
    http: ResilientHttpClient | None = None,
) -> None:
    if http is not None:
        await _sync(session, images, progress, http)
        return
    async with ResilientHttpClient(VALORANT_API, timeout=15.0, max_retries=3) as client:
        await _sync(session, images, progress, client)


async def _sync(
    session: AsyncSession, images: CatalogImageMirror, progress: CatalogSyncProgress, http: ResilientHttpClient
) -> None:
    await progress.report_source("valorant-api.com")
    agents = agent_rows((await fetch_json(http, "/v1/agents?isPlayableCharacter=true"))["data"])
    maps = map_rows((await fetch_json(http, "/v1/maps"))["data"])
    await apply_source(session, http, images, progress, discipline=DISCIPLINE, kind="map", rows=maps)
    await apply_source(session, http, images, progress, discipline=DISCIPLINE, kind="character", rows=agents)
