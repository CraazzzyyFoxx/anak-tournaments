"""Admin CRUD for ``catalog.entity`` by discipline and kind (D85).

The discipline module decides which kinds a game has and which classes a character may carry; the database decides
the rest (slug/name unique per discipline and kind, a parent of the same discipline). Commits: the admin request is the
transaction.
"""

from __future__ import annotations

import json

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.catalog_aliases import normalize_aliases, slugify
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dict
from shared.disciplines import DISCIPLINES, DisciplineSpec
from shared.repository import CatalogEntityRepository
from src import models, schemas

__all__ = ("CatalogAdminService", "catalog", "check_attrs", "check_parent", "kind_spec", "to_read")

_WITH_PARENT = [selectinload(models.CatalogEntity.parent)]


def kind_spec(discipline: str, kind: str) -> DisciplineSpec:
    """The module behind ``discipline`` when it declares ``kind``; 404 otherwise."""
    spec = DISCIPLINES.get(discipline)
    if spec is None or kind not in spec.kinds:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"No catalog kind {kind!r} in discipline {discipline!r}"
        )
    return spec


def check_attrs(spec: DisciplineSpec, kind: str, attrs: dict) -> None:
    try:
        spec.validate_attrs(kind, attrs)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


def check_parent(spec: DisciplineSpec, kind: str, parent_id: int | None) -> None:
    """A map of a game with modes sits under one; nothing else has a parent."""
    if kind == "map" and "mode" in spec.kinds:
        if parent_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A map needs its mode as parent_id"
            )
    elif parent_id is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only a map has a parent")


def to_read(entity: models.CatalogEntity) -> schemas.CatalogEntityRead:
    """``parent`` must be loaded (``_WITH_PARENT``): an async lazy load would raise."""
    return schemas.CatalogEntityRead.from_entity(entity)


class CatalogAdminService:
    async def _parent_exists(self, session: AsyncSession, spec: DisciplineSpec, parent_id: int | None) -> None:
        if (
            parent_id is not None
            and await CatalogEntityRepository("mode", discipline=spec.code).get(session, parent_id) is None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="parent_id is not a mode of this discipline"
            )

    async def _unique(
        self, session: AsyncSession, repo: CatalogEntityRepository, *, slug: str, name: str, own_id: int | None = None
    ) -> None:
        if len(slug) > 64:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="slug must fit 64 characters")
        for field, value in (("slug", slug), ("name", name)):
            clash = await repo.get_by(session, **{field: value})
            if clash is not None and clash.id != own_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} {value!r} already exists")

    async def list(
        self, session: AsyncSession, discipline: str, kind: str, params: schemas.CatalogEntityListParams
    ) -> dict:
        kind_spec(discipline, kind)
        entity = models.CatalogEntity
        filters = []
        if params.search:
            filters.append(entity.name.ilike(f"%{params.search}%"))
        if params.parent_id is not None:
            filters.append(entity.parent_id == params.parent_id)
        if params.attrs:
            filters.append(entity.attrs.contains(json.loads(params.attrs)))
        if params.active is not None:
            filters.append(entity.active.is_(params.active))
        rows, total = await CatalogEntityRepository(kind, discipline=discipline).list(
            session, params, filters=filters, options=_WITH_PARENT
        )
        return paginated_dict([to_read(row) for row in rows], total, params)

    async def create(
        self, session: AsyncSession, discipline: str, kind: str, data: schemas.CatalogEntityCreate
    ) -> models.CatalogEntity:
        spec = kind_spec(discipline, kind)
        check_attrs(spec, kind, data.attrs)
        check_parent(spec, kind, data.parent_id)
        await self._parent_exists(session, spec, data.parent_id)
        repo = CatalogEntityRepository(kind, discipline=discipline)
        slug = data.slug or slugify(data.name)
        await self._unique(session, repo, slug=slug, name=data.name)
        entity = models.CatalogEntity(
            discipline=discipline,
            kind=kind,
            slug=slug,
            name=data.name,
            image_path=data.image_path,
            parent_id=data.parent_id,
            attrs=dict(data.attrs),
            aliases=normalize_aliases(data.aliases, canonical=data.name),
            active=data.active,
        )
        await repo.create(session, entity)
        await session.commit()
        return await repo.get(session, entity.id, options=_WITH_PARENT, populate_existing=True)

    async def update(
        self, session: AsyncSession, discipline: str, kind: str, entity_id: int, data: schemas.CatalogEntityUpdate
    ) -> models.CatalogEntity:
        spec = kind_spec(discipline, kind)
        repo = CatalogEntityRepository(kind, discipline=discipline)
        entity = await repo.get(session, entity_id)
        if entity is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entity not found")
        changes = data.model_dump(exclude_unset=True)
        if "attrs" in changes:
            changes["attrs"] = {**entity.attrs, **changes["attrs"]}
        check_attrs(spec, kind, changes.get("attrs", entity.attrs))
        check_parent(spec, kind, changes.get("parent_id", entity.parent_id))
        if "parent_id" in changes:
            await self._parent_exists(session, spec, changes["parent_id"])
        await self._unique(
            session,
            repo,
            slug=changes.get("slug", entity.slug),
            name=changes.get("name", entity.name),
            own_id=entity.id,
        )
        if "aliases" in changes:
            changes["aliases"] = normalize_aliases(changes["aliases"] or [], canonical=changes.get("name", entity.name))
        await repo.update_fields(session, entity, changes)
        await session.commit()
        return await repo.get(session, entity.id, options=_WITH_PARENT, populate_existing=True)

    async def delete(self, session: AsyncSession, discipline: str, kind: str, entity_id: int) -> None:
        kind_spec(discipline, kind)
        repo = CatalogEntityRepository(kind, discipline=discipline)
        entity = await repo.get(session, entity_id)
        if entity is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog entity not found")
        try:
            await repo.delete(session, entity)
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            if getattr(exc.orig, "sqlstate", None) == "23503":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog entity is in use") from exc
            raise


catalog = CatalogAdminService()
