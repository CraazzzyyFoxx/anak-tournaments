import typing

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import config, errors

from . import service

# Every Blizzard locale OverFast serves (`GET /heroes?locale=`). Match logs are
# written in the reporting client's locale, so all thirteen are pulled: twelve
# extra requests once per sync against silently dropped statistics.
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


async def fetch_heroes(locale: str = CANONICAL_LOCALE) -> list[schemas.OverfastHero]:
    # `role` comes back in the payload whatever the filter, so no ?role= is
    # needed: one request per locale instead of one per role.
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(f"{config.settings.overfast_base_url}/heroes?locale={locale}")
        response.raise_for_status()

    return [schemas.OverfastHero.model_validate(hero) for hero in response.json()]


def merge_aliases(*, existing: typing.Iterable[str], localized: typing.Iterable[str], canonical: str) -> list[str]:
    """Union of the stored and the localized names, minus the canonical one.

    ponytail: only ever adds, never removes — an alias carries no provenance, so
    the sync cannot tell its own stale entry from a hand-added one. When OverFast
    renames a hero, the stale alias is dropped through the admin UI.
    """
    return sorted({*existing, *localized} - {canonical})


async def initial_create(session: AsyncSession) -> None:
    # Canonical pass first, then one pass per alias locale. All the OverFast
    # round-trips happen before the first DB read, so no transaction is held
    # open across them.
    canonical_heroes = await fetch_heroes(CANONICAL_LOCALE)
    localized: dict[str, set[str]] = {hero.key: {hero.name} for hero in canonical_heroes}
    for locale in ALIAS_LOCALES:
        for hero in await fetch_heroes(locale):
            localized.setdefault(hero.key, set()).add(hero.name)

    # One existence query + one bulk insert instead of a get-then-create pair
    # per hero. Pre-existing rows keep their name/type/image_path — only
    # `aliases` is refreshed, and only by reassignment: JSONB does not track
    # in-place mutation.
    existing_heroes = await service.get_by_slugs(session, [hero.key for hero in canonical_heroes])
    new_heroes: list[models.Hero] = []
    for hero in canonical_heroes:
        hero_db = existing_heroes.get(hero.key)
        if hero_db is None:
            hero_db = models.Hero(
                slug=hero.key,
                name=hero.name,
                type=hero.role,  # type: ignore
                image_path=hero.portrait,
            )
            existing_heroes[hero.key] = hero_db
            new_heroes.append(hero_db)
        hero_db.aliases = merge_aliases(
            existing=hero_db.aliases or [],
            localized=localized[hero.key],
            canonical=hero_db.name,
        )

    if new_heroes:
        session.add_all(new_heroes)
    await session.commit()


async def get_by_name(session: AsyncSession, name: str) -> models.Hero:
    hero = await service.get_by_name(session, name)
    if not hero:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg=f"Hero with name {name} not found"),
            ],
        )
    return hero


async def get_by_slug(session: AsyncSession, slug: str) -> models.Hero:
    hero = await service.get_by_slug(session, slug)
    if not hero:
        raise errors.ApiHTTPException(
            status_code=404,
            detail=[
                errors.ApiExc(code="not_found", msg=f"Hero with slug {slug} not found"),
            ],
        )
    return hero
