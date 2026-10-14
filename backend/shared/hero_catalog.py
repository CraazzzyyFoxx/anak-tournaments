"""Resolve the hero catalog used to validate and persist registration top-hero picks.

Overwatch characters in ``catalog.entity`` are global (not workspace-scoped), so the catalog is a flat mapping from
hero slug to a light reference carrying the entity id and class. The public registration path validates submitted
slugs against the role's class and translates them into ``entity_id`` foreign keys when persisting
``balancer.registration_role_entity`` rows.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import enums

DEFAULT_MAX_TOP_HEROES = 5


@dataclass(frozen=True)
class HeroCatalogEntry:
    id: int
    slug: str
    #: A hero's class, so never ``HeroClass.flex``: flex is a roster role a
    #: player holds. Registration's top-hero validation compares this against
    #: the role the applicant declared, and a flex-typed hero would pass for a
    #: role it has nothing to do with. Enforced by the module's ``character_classes``.
    hero_class: enums.HeroTypeClass


HeroCatalog = dict[str, HeroCatalogEntry]


async def resolve_hero_catalog(session: AsyncSession) -> HeroCatalog:
    """Return ``{hero_slug: HeroCatalogEntry}`` for every Overwatch character."""
    entity = models.CatalogEntity
    rows = (
        await session.execute(
            sa.select(entity.id, entity.slug, entity.attrs["class"].astext).where(
                entity.discipline == "overwatch", entity.kind == "character"
            )
        )
    ).all()
    return {
        slug: HeroCatalogEntry(id=entity_id, slug=slug, hero_class=enums.HeroClass[hero_class])
        for entity_id, slug, hero_class in rows
    }


def build_hero_entries(
    slugs: list[str] | None,
    *,
    hero_catalog: HeroCatalog,
    max_heroes: int,
) -> list[models.BalancerRegistrationRoleEntity]:
    """Translate ordered hero slugs into ``registration_role_entity`` rows.

    De-duplicates, drops unknown slugs, caps at ``max_heroes`` and assigns a
    1-based priority (1 = top pick).
    """
    hero_entries: list[models.BalancerRegistrationRoleEntity] = []
    seen: set[str] = set()
    for slug in slugs or []:
        if slug in seen:
            continue
        entry = hero_catalog.get(slug)
        if entry is None:
            continue
        seen.add(slug)
        hero_entries.append(models.BalancerRegistrationRoleEntity(entity_id=entry.id, priority=len(hero_entries) + 1))
        if len(hero_entries) >= max_heroes:
            break
    return hero_entries
