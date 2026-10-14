"""League of Legends' catalog source: Riot's Data Dragon (D85, D98).

Champions (class = first tag; Riot's id as an alias when it differs from the display name, e.g. ``MonkeyKing`` for
Wukong — the id is what Riot's match data names) and maps. LoL has no modes.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import slugify
from shared.catalog_sync import CatalogImageMirror, SourceEntity, apply_source, fetch_json
from shared.clients.http_client import ResilientHttpClient

__all__ = ("DATA_DRAGON", "sync_catalog")

DISCIPLINE = "lol"
DATA_DRAGON = "https://ddragon.leagueoflegends.com"


async def sync_catalog(
    session: AsyncSession, images: CatalogImageMirror, http: ResilientHttpClient | None = None
) -> None:
    if http is not None:
        await _sync(session, images, http)
        return
    async with ResilientHttpClient(DATA_DRAGON, timeout=15.0, max_retries=3) as client:
        await _sync(session, images, client)


async def _sync(session: AsyncSession, images: CatalogImageMirror, http: ResilientHttpClient) -> None:
    version = (await fetch_json(http, "/api/versions.json"))[0]
    champions = (await fetch_json(http, f"/cdn/{version}/data/en_US/champion.json"))["data"].values()
    maps = (await fetch_json(http, f"/cdn/{version}/data/en_US/map.json"))["data"].values()
    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="character",
        rows=[
            SourceEntity(
                slug=slugify(champion["id"]),
                name=champion["name"],
                image_url=f"{DATA_DRAGON}/cdn/{version}/img/champion/{champion['image']['full']}",
                attrs={"class": champion["tags"][0]} if champion.get("tags") else {},
                aliases=(champion["id"],) if champion["id"] != champion["name"] else (),
            )
            for champion in champions
        ],
    )
    # Data Dragon repeats a map name across map ids (seasonal variants); the oldest id wins.
    by_name: dict[str, dict] = {}
    for game_map in sorted(maps, key=lambda entry: int(entry["MapId"])):
        by_name.setdefault(game_map["MapName"], game_map)
    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="map",
        rows=[
            SourceEntity(
                slug=slugify(name),
                name=name,
                image_url=f"{DATA_DRAGON}/cdn/{version}/img/map/{game_map['image']['full']}",
            )
            for name, game_map in by_name.items()
        ],
    )
