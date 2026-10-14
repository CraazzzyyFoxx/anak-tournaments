"""Overwatch's catalog source: OverFast (D85, §8.1).

Modes, then maps (each under the first mode that lists it), then heroes with the Blizzard name of every locale as
aliases — match logs are written in the reporting client's locale. Every OverFast round-trip happens before the first
DB read, so no transaction is held open across them.
"""

from __future__ import annotations

import asyncio

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from shared.catalog_aliases import slugify
from shared.catalog_sync import CatalogImageMirror, SourceEntity, apply_source, fetch_json
from shared.clients.http_client import ResilientHttpClient

__all__ = ("ALIAS_LOCALES", "CANONICAL_LOCALE", "sync_catalog")

DISCIPLINE = "overwatch"
# Every Blizzard locale OverFast serves (`GET /heroes?locale=`): twelve extra requests per sync against silently
# dropped statistics.
CANONICAL_LOCALE = "en-us"
ALIAS_LOCALES = (
    "de-de",
    "en-gb",
    "es-es",
    "es-mx",
    "fr-fr",
    "it-it",
    "ja-jp",
    "ko-kr",
    "pl-pl",
    "pt-br",
    "ru-ru",
    "zh-tw",
)
_LOCALE_FETCH_CONCURRENCY = 4


class _Settings(BaseSettings):
    """The variable the parser's rank collector reads too (``OVERFAST_BASE_URL``)."""

    model_config = SettingsConfigDict(env_file=(".env", ".env.prod"), env_file_encoding="utf-8", extra="ignore")

    overfast_base_url: str = "https://overfast.craazzzyyfoxx.me"


async def sync_catalog(
    session: AsyncSession, images: CatalogImageMirror, http: ResilientHttpClient | None = None
) -> None:
    if http is not None:
        await _sync(session, images, http)
        return
    async with ResilientHttpClient(_Settings().overfast_base_url, timeout=15.0, max_retries=3) as client:
        await _sync(session, images, client)


async def _sync(session: AsyncSession, images: CatalogImageMirror, http: ResilientHttpClient) -> None:
    gamemodes = await fetch_json(http, "/gamemodes")
    # ponytail: sequential — a handful of modes; parallelize like the locales if that grows.
    maps_by_mode = [(mode["key"], await fetch_json(http, f"/maps?gamemode={mode['key']}")) for mode in gamemodes]
    heroes = await fetch_json(http, f"/heroes?locale={CANONICAL_LOCALE}")
    semaphore = asyncio.Semaphore(_LOCALE_FETCH_CONCURRENCY)

    async def _locale(locale: str) -> list[dict]:
        async with semaphore:
            return await fetch_json(http, f"/heroes?locale={locale}")

    localized: dict[str, set[str]] = {hero["key"]: {hero["name"]} for hero in heroes}
    for batch in await asyncio.gather(*(_locale(locale) for locale in ALIAS_LOCALES)):
        for hero in batch:
            localized.setdefault(hero["key"], set()).add(hero["name"])

    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="mode",
        rows=[
            SourceEntity(
                slug=mode["key"],
                name=mode["name"],
                image_url=mode["icon"],
                attrs={"description": mode["description"]} if mode.get("description") else {},
            )
            for mode in gamemodes
        ],
    )
    map_rows: dict[str, SourceEntity] = {}
    for mode_key, maps in maps_by_mode:
        for game_map in maps:
            slug = slugify(game_map["name"])
            map_rows.setdefault(
                slug,
                SourceEntity(
                    slug=slug,
                    name=game_map["name"],
                    image_url=game_map["screenshot"],
                    attrs={"in_competitive": True},
                    parent_slug=mode_key,
                ),
            )
    await apply_source(session, http, images, discipline=DISCIPLINE, kind="map", rows=list(map_rows.values()))
    await apply_source(
        session,
        http,
        images,
        discipline=DISCIPLINE,
        kind="character",
        rows=[
            SourceEntity(
                slug=hero["key"],
                name=hero["name"],
                image_url=hero["portrait"],
                attrs={"class": hero["role"]},
                aliases=tuple(sorted(localized[hero["key"]])),
            )
            for hero in heroes
        ],
    )
