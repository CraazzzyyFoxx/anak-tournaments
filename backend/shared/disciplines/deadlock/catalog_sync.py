"""Deadlock's catalog source: deadlock-api assets.

Heroes (``player_selectable`` and not ``disabled``; ``in_development`` heroes stay, private lobbies play them): code =
``class_name`` without ``hero_`` (``inferno`` for Infernus), the slugified display name as an alias, class =
``hero_type``, ``attrs.deadlock_id`` = the numeric id match metadata names. One map, ``midtown``, and the two modes
``normal`` and ``street_brawl``; deadlock-api has no mode art, so the modes reuse the minimap. Every deadlock-api read
happens before the first catalog write.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import slugify
from shared.catalog_sync import CatalogImageMirror, SourceEntity, apply_source, fetch_json
from shared.clients.http_client import ResilientHttpClient
from shared.disciplines.deadlock.client import deadlock_client

__all__ = ("MAP_SLUG", "MODES", "hero_rows", "sync_catalog")

DISCIPLINE = "deadlock"
MAP_SLUG = "midtown"
MODES: tuple[tuple[str, str], ...] = (("normal", "Standard"), ("street_brawl", "Street Brawl"))


def hero_rows(heroes: list[dict[str, Any]]) -> list[SourceEntity]:
    rows = []
    for hero in heroes:
        if not hero.get("player_selectable") or hero.get("disabled"):
            continue
        slug = str(hero["class_name"]).removeprefix("hero_")
        alias = slugify(hero["name"])
        rows.append(
            SourceEntity(
                slug=slug,
                name=hero["name"],
                image_url=hero["images"]["icon_hero_card"],
                attrs={"class": hero["hero_type"], "deadlock_id": int(hero["id"])},
                aliases=(alias,) if alias != slug else (),
            )
        )
    return rows


async def sync_catalog(
    session: AsyncSession, images: CatalogImageMirror, http: ResilientHttpClient | None = None
) -> None:
    if http is not None:
        await _sync(session, images, http)
        return
    async with deadlock_client() as client:
        await _sync(session, images, client)


async def _sync(session: AsyncSession, images: CatalogImageMirror, http: ResilientHttpClient) -> None:
    characters = hero_rows(await fetch_json(http, "/v1/assets/heroes"))
    minimap = (await fetch_json(http, "/v1/assets/map"))["images"]["minimap"]
    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="mode",
        rows=[SourceEntity(slug=slug, name=name, image_url=minimap) for slug, name in MODES],
    )
    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="map",
        rows=[SourceEntity(slug=MAP_SLUG, name="Midtown", image_url=minimap)],
    )
    await apply_source(session, http, images, discipline=DISCIPLINE, kind="character", rows=characters)
