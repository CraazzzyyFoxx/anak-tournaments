"""What every discipline's catalog sync shares: the image mirror and the upsert of one kind.

A module's sync (``shared/disciplines/<slug>/catalog_sync.py``) fetches its source and hands rows here. A row is matched
by slug first, then by exact name, inside its discipline and kind. A new row is created whole; an existing row keeps
its slug, name and attrs (an admin may have edited them) and gets the source's image (unless already on our bucket)
and the union of the aliases. An existing parent is kept; a missing one is filled from the source. Nothing is deleted.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection, Iterable, Mapping, Sequence
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

__all__ = ("CatalogImageMirror", "CatalogSyncProgress", "SourceEntity", "apply_source", "fetch_json", "merge_aliases")

# A first sync mirrors ~170 images through the proxy, four at a time.
_IMAGE_FETCH_CONCURRENCY = 4
# The order every module writes its kinds in: a map's parent is a mode, synced first.
_SYNC_ORDER = ("mode", "map", "character")


class CatalogSyncProgress:
    """The live half of a sync's snapshot: its source's name and its stages; every change awaits ``on_change(self)``.

    The stages run in order: ``source`` (running from the start: every module fetches its whole source before its
    first write), then the discipline's kinds in sync order (mode, map, character). A kind counts the images it
    actually downloads.
    """

    def __init__(self, kinds: Collection[str], on_change: Callable[[CatalogSyncProgress], Awaitable[object]]) -> None:
        self.source: str | None = None
        self.stages: dict[str, dict[str, Any]] = {
            key: {"key": key, "state": "pending", "done": None, "total": None, "created": None}
            for key in ("source", *(kind for kind in _SYNC_ORDER if kind in kinds))
        }
        self.stages["source"]["state"] = "running"
        self._on_change = on_change

    async def report_source(self, name: str) -> None:
        self.source = name
        await self._on_change(self)

    async def begin(self, kind: str) -> None:
        self.stages["source"]["state"] = "done"
        self.stages[kind]["state"] = "running"
        await self._on_change(self)

    async def images(self, kind: str, total: int) -> None:
        self.stages[kind].update(done=0, total=total)
        await self._on_change(self)

    async def image_mirrored(self, kind: str) -> None:
        self.stages[kind]["done"] += 1
        await self._on_change(self)

    async def finish(self, kind: str, created: int) -> None:
        self.stages[kind].update(state="done", created=created)
        await self._on_change(self)

    def fail(self) -> None:
        """Mark the stage the sync died in: stages run in order, so it is the first one not done."""
        failed = next((stage for stage in self.stages.values() if stage["state"] != "done"), None)
        if failed is not None:
            failed["state"] = "failed"


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
        progress: CatalogSyncProgress,
        *,
        discipline: str,
        kind: str,
        images: Mapping[str, tuple[str | None, str]],
    ) -> dict[str, str]:
        """``{slug: (current, source)}`` -> ``{slug: url to store}``; counts the downloads on ``kind``'s stage."""
        semaphore = asyncio.Semaphore(_IMAGE_FETCH_CONCURRENCY)
        await progress.images(kind, sum(not self.is_mirrored(current) for current, _source in images.values()))

        async def _resolve(slug: str, current: str | None, source: str) -> str:
            if current and self.is_mirrored(current):
                return current
            async with semaphore:
                url = await self.mirror(http, discipline=discipline, kind=kind, slug=slug, source_url=source)
            await progress.image_mirrored(kind)
            return url

        slugs = list(images)
        tasks = [asyncio.create_task(_resolve(slug, *images[slug])) for slug in slugs]
        try:
            urls = await asyncio.gather(*tasks)
        except BaseException:
            # gather leaves the rest running: their progress would land after the sync's failure and reset it to running.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
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
    progress: CatalogSyncProgress,
    *,
    discipline: str,
    kind: str,
    rows: Sequence[SourceEntity],
) -> int:
    """Upsert one kind of one discipline from its source; returns how many rows were created. Commits.

    Runs ``kind``'s stage on ``progress``: running from the first check, done with its created count after the commit.
    """
    await progress.begin(kind)
    spec = DISCIPLINES[discipline]
    for row in rows:
        spec.validate_attrs(kind, row.attrs)
    repo = CatalogEntityRepository(kind, discipline=discipline)
    entity = models.CatalogEntity
    existing = await repo.get_many_by(session, entity.slug, [row.slug for row in rows])
    existing_by_name = await repo.get_many_by(session, entity.name, [row.name for row in rows])
    for row in rows:
        if row.slug not in existing and row.name in existing_by_name:
            existing[row.slug] = existing_by_name[row.name]
    parents = await CatalogEntityRepository("mode", discipline=discipline).get_many_by(
        session, entity.slug, sorted({row.parent_slug for row in rows if row.parent_slug})
    )
    # Release the read transaction before the image round-trips; expire_on_commit=False keeps the rows loaded.
    await session.commit()
    image_paths = await images.resolve_many(
        http,
        progress,
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
    await progress.finish(kind, len(created))
    return len(created)
