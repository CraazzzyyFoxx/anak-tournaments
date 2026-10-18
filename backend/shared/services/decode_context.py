"""Load the catalog a raw decoder resolves names against: one read, handed to a pure function (``DecodeContext``)."""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.disciplines.ingest import DecodeContext
from shared.schemas.match_doc import MatchHint, MatchSource

__all__ = ("load_decode_context",)


async def load_decode_context(
    session: AsyncSession,
    *,
    discipline: str,
    source: MatchSource,
    hint: MatchHint | None,
    received_at: datetime,
) -> DecodeContext:
    """Active characters, maps and modes of ``discipline`` as a log spells them (canonical name or alias).

    A canonical name is never shadowed by another entity's alias; the first alias of two entities wins. Maps are keyed
    by their mode too, because a log names both and a map is only that map inside its own mode.
    """
    entity = models.CatalogEntity
    rows = (
        await session.execute(
            sa.select(entity.id, entity.kind, entity.slug, entity.name, entity.aliases, entity.parent_id, entity.attrs)
            .where(entity.discipline == discipline, entity.active.is_(True))
            .order_by(entity.id)
        )
    ).all()
    modes = {row.id: (row.name, *row.aliases) for row in rows if row.kind == "mode"}
    characters: dict[str, str] = {}
    maps: dict[tuple[str, str], str] = {}
    attrs: dict[str, dict] = {}
    for row in rows:
        if row.kind == "character":
            characters[row.name] = row.slug
            for alias in row.aliases:
                characters.setdefault(alias, row.slug)
            attrs[row.slug] = row.attrs
        elif row.kind == "map":
            for mode_name in modes.get(row.parent_id, ()):
                for name in (row.name, *row.aliases):
                    maps.setdefault((mode_name, name), row.slug)
    return DecodeContext(
        discipline=discipline,
        source=source,
        hint=hint,
        received_at=received_at,
        characters=characters,
        maps=maps,
        attrs=attrs,
    )
