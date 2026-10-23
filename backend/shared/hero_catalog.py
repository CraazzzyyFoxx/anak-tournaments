"""Resolve the character catalog that registration top-character picks are validated and persisted against.

Characters in ``catalog.entity`` are global per discipline (not workspace-scoped), so the catalog is a flat mapping
from character slug to a light reference carrying the entity id. The public registration path validates submitted
slugs against the OWNING tournament's discipline and translates them into ``entity_id`` foreign keys when persisting
``registration.role_entity`` rows. A character's class is display/filter metadata only: no player role is
ever inferred from it, so a pick is valid for any role the registrant declares.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models

DEFAULT_MAX_TOP_HEROES = 5


@dataclass(frozen=True)
class HeroCatalogEntry:
    id: int
    slug: str


HeroCatalog = dict[str, HeroCatalogEntry]


async def resolve_hero_catalog(session: AsyncSession, *, discipline: str) -> HeroCatalog:
    """Return ``{slug: HeroCatalogEntry}`` for every character of ``discipline``."""
    entity = models.CatalogEntity
    rows = (
        await session.execute(
            sa.select(entity.id, entity.slug).where(entity.discipline == discipline, entity.kind == "character")
        )
    ).all()
    return {slug: HeroCatalogEntry(id=entity_id, slug=slug) for entity_id, slug in rows}


def build_hero_entries(
    slugs: list[str] | None,
    *,
    hero_catalog: HeroCatalog,
    max_heroes: int,
) -> list[models.RegistrationRoleEntity]:
    """Translate ordered character slugs into ``registration_role_entity`` rows.

    De-duplicates, drops unknown slugs, caps at ``max_heroes`` and assigns a
    1-based priority (1 = top pick).
    """
    hero_entries: list[models.RegistrationRoleEntity] = []
    seen: set[str] = set()
    for slug in slugs or []:
        if slug in seen:
            continue
        entry = hero_catalog.get(slug)
        if entry is None:
            continue
        seen.add(slug)
        hero_entries.append(models.RegistrationRoleEntity(entity_id=entry.id, priority=len(hero_entries) + 1))
        if len(hero_entries) >= max_heroes:
            break
    return hero_entries
