"""What every discipline's catalog sync shares (D85): the image mirror and the upsert of one kind.

A module's sync (``shared/disciplines/<slug>/catalog_sync.py``) fetches its source and hands rows here. A row is matched
by slug inside its discipline and kind. A new row is created whole; an existing row keeps its name and attrs
(an admin may have edited them) and gets the source's image (unless already on our bucket) and the union of the
aliases. An existing parent is kept; a missing one is filled from the source. Nothing is ever deleted.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.clients import S3Client
from shared.clients.http_client import ResilientHttpClient
from shared.disciplines import DISCIPLINES
from shared.repository import CatalogEntityRepository

__all__ = ("CatalogImageMirror", "SourceEntity", "apply_source", "fetch_json", "merge_aliases")

# A first sync mirrors ~170 images through the proxy; four at a time stays well inside the 120 s RPC budget.
_IMAGE_FETCH_CONCURRENCY = 4


def merge_aliases(*, existing: Iterable[str], localized: Iterable[str], canonical: str) -> list[str]:
    """Union of the stored and the source names, minus the canonical one.

    ponytail: only ever adds — an alias carries no provenance, so the sync cannot tell its own stale entry from a
    hand-added one. A renamed entry's stale alias is dropped through the admin UI.
    """
    return sorted({*existing, *localized} - {canonical})


async def fetch_json(http: ResilientHttpClient, path: str) -> Any:
    response = await http.get(path)
    response.raise_for_status()
    return response.json()


class CatalogImageMirror:
    """Copies source images into our S3 bucket, so the site never renders them from a host visitors may not reach.

    A row already on the bucket keeps its image (an image an admin replaced by hand survives the sync). Any failure
    raises and fails the sync: a half-mirrored catalog is a catalog of broken images.
    """

    def __init__(self, s3: S3Client) -> None:
        self.s3 = s3

    def is_mirrored(self, url: str | None) -> bool:
        return bool(url) and url.startswith(self.s3.get_public_url(""))

    async def mirror(self, http: ResilientHttpClient, *, discipline: str, kind: str, slug: str, source_url: str) -> str:
        response = await http.get(source_url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";")[0].strip()
        # It is re-published public from our bucket: an HTML error page must not be.
        if not content_type.startswith("image/"):
            raise ValueError(f"{source_url} returned {content_type or 'no content type'}, not an image")
        key = f"assets/{discipline}/{kind}/{slug}{PurePosixPath(urlparse(source_url).path).suffix.lower()}"
        if not await self.s3.put_object(key, response.content, content_type, public=True):
            raise RuntimeError(f"S3 upload failed for {key}")
        return self.s3.get_public_url(key)

    async def resolve_many(
        self,
        http: ResilientHttpClient,
        *,
        discipline: str,
        kind: str,
        images: Mapping[str, tuple[str | None, str]],
    ) -> dict[str, str]:
        """``{slug: (current, source)}`` -> ``{slug: url to store}``."""
        semaphore = asyncio.Semaphore(_IMAGE_FETCH_CONCURRENCY)

        async def _resolve(slug: str, current: str | None, source: str) -> str:
            if current and self.is_mirrored(current):
                return current
            async with semaphore:
                return await self.mirror(http, discipline=discipline, kind=kind, slug=slug, source_url=source)

        slugs = list(images)
        urls = await asyncio.gather(*(_resolve(slug, *images[slug]) for slug in slugs))
        return dict(zip(slugs, urls, strict=True))


@dataclass(frozen=True, slots=True)
class SourceEntity:
    slug: str
    name: str
    image_url: str
    attrs: dict[str, Any] = field(default_factory=dict, hash=False)
    aliases: tuple[str, ...] = ()
    #: A map's mode, by slug, in the same discipline (synced first).
    parent_slug: str | None = None


async def apply_source(
    session: AsyncSession,
    http: ResilientHttpClient,
    images: CatalogImageMirror,
    *,
    discipline: str,
    kind: str,
    rows: Sequence[SourceEntity],
) -> int:
    """Upsert one kind of one discipline from its source; returns how many rows were created. Commits."""
    spec = DISCIPLINES[discipline]
    for row in rows:
        spec.validate_attrs(kind, row.attrs)
    repo = CatalogEntityRepository(kind, discipline=discipline)
    entity = models.CatalogEntity
    existing = await repo.get_many_by(session, entity.slug, [row.slug for row in rows])
    parents = await CatalogEntityRepository("mode", discipline=discipline).get_many_by(
        session, entity.slug, sorted({row.parent_slug for row in rows if row.parent_slug})
    )
    # Release the read transaction before the image round-trips; expire_on_commit=False keeps the rows loaded.
    await session.commit()
    image_paths = await images.resolve_many(
        http,
        discipline=discipline,
        kind=kind,
        images={row.slug: (getattr(existing.get(row.slug), "image_path", None), row.image_url) for row in rows},
    )
    created: list[models.CatalogEntity] = []
    for row in rows:
        current = existing.get(row.slug)
        if current is None:
            current = entity(discipline=discipline, kind=kind, slug=row.slug, name=row.name, attrs=dict(row.attrs))
            existing[row.slug] = current
            created.append(current)
        current.image_path = image_paths[row.slug]
        current.aliases = merge_aliases(existing=current.aliases or [], localized=row.aliases, canonical=current.name)
        if row.parent_slug is not None and current.parent_id is None:
            current.parent_id = parents[row.parent_slug].id
    if created:
        await repo.create_many(session, created)
    await session.commit()
    return len(created)
