"""League of Legends' catalog source: Riot's Data Dragon (D85, D98).

Champions (class = first tag; Riot's id as an alias when it differs from the display name, e.g. ``MonkeyKing`` for
Wukong — the id is what Riot's match data names) and maps. LoL has no modes. Map 11 (Summoner's Rift) gets the fixed
canonical code ``summoners_rift`` (architecture §7.3); every other map's code is its slugified name.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.catalog_aliases import slugify
from shared.catalog_sync import CatalogImageMirror, SourceEntity, apply_source, fetch_json, merge_aliases
from shared.clients.http_client import ResilientHttpClient
from shared.core.errors import ApiExc, ApiHTTPException
from shared.repository import CatalogEntityRepository

__all__ = ("DATA_DRAGON", "sync_catalog")

DISCIPLINE = "lol"
DATA_DRAGON = "https://ddragon.leagueoflegends.com"
SUMMONERS_RIFT = "summoners_rift"  # Data Dragon MapId 11's canonical code (architecture §7.3)


def _map_slug(game_map: dict, name: str) -> str:
    return SUMMONERS_RIFT if str(game_map["MapId"]) == "11" else slugify(name)


async def _adopt_canonical_map(session: AsyncSession, name: str) -> None:
    """Give the one row an earlier sync created for map 11 under ``slugify(name)`` the canonical code; commits.

    The row keeps its id (every FK), name, attrs, active and parent; its old code stays behind as an alias (a lookup
    breadcrumb — canonical ingest still resolves exact codes only). A match the sync cannot pin to one row is refused
    with 409 ``catalog_conflict`` before the map batch writes: several candidates, or a single one matched only by an
    alias (``apply_source`` would insert a duplicate beside it). A row an admin re-slugged keeps its slug:
    ``apply_source`` finds it by name.
    """
    legacy = slugify(name)
    entity = models.CatalogEntity
    repo = CatalogEntityRepository("map", discipline=DISCIPLINE)
    candidates, _ = await repo.list(
        session,
        filters=[
            sa.or_(
                entity.slug.in_((SUMMONERS_RIFT, legacy)),
                entity.name == name,
                entity.aliases.contains([name]),
                entity.aliases.contains([legacy]),
            )
        ],
    )
    if not candidates:
        return
    if len(candidates) == 1:
        (current,) = candidates
        if current.slug == SUMMONERS_RIFT:
            return
        if current.slug == legacy:
            aliases = merge_aliases(existing=current.aliases, localized=(legacy,), canonical=current.name)
            await repo.update_fields(session, current, {"slug": SUMMONERS_RIFT, "aliases": aliases})
            await session.commit()
            return
        if current.name == name:
            return
    ids = sorted(candidate.id for candidate in candidates)
    raise ApiHTTPException(
        409,
        [
            ApiExc(
                code="catalog_conflict",
                msg=f"Data Dragon map {name!r} matches catalog rows {ids}; resolve them in the catalog admin first",
            )
        ],
    )


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
    # Data Dragon repeats a map name across map ids (seasonal variants); the oldest id wins. It also lists
    # map ids with an empty MapName (453 in 16.20): nothing to show or match a log against, so they are skipped.
    by_name: dict[str, dict] = {}
    for game_map in sorted(maps, key=lambda entry: int(entry["MapId"])):
        if name := game_map["MapName"].strip():
            by_name.setdefault(name, game_map)
    if canonical := next((name for name, game_map in by_name.items() if str(game_map["MapId"]) == "11"), None):
        await _adopt_canonical_map(session, canonical)
    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="map",
        rows=[
            SourceEntity(
                slug=_map_slug(game_map, name),
                name=name,
                image_url=f"{DATA_DRAGON}/cdn/{version}/img/map/{game_map['image']['full']}",
            )
            for name, game_map in by_name.items()
        ],
    )
