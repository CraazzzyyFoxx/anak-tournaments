from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.balancer_registration_statuses import (
    StatusScope,
    get_builtin_status_values,
    invalidate_status_metas_cache,
    normalize_status_slug,
)
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import RegistrationStatusRepository, WorkspaceRepository
from src import models

__all__ = ("RegistrationStatusCatalogService", "status_catalog_service")


def _normalize_name_to_slug(name: str) -> str:
    slug = normalize_status_slug(name)
    if not slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status name must contain letters or digits",
        )
    return slug


class RegistrationStatusCatalogService:
    """Workspace-scoped registration/balancer status catalog: builtins, custom
    statuses and per-workspace builtin overrides."""

    def __init__(
        self,
        *,
        status_repo: RegistrationStatusRepository = RegistrationStatusRepository(),
        workspace_repo: WorkspaceRepository = WorkspaceRepository(),
    ) -> None:
        self.status_repo = status_repo
        self.workspace_repo = workspace_repo

    async def ensure_workspace_exists(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> models.Workspace:
        workspace = await self.workspace_repo.get(session, workspace_id)
        if workspace is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workspace not found",
            )
        return workspace

    async def list_status_catalog(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> list[models.BalancerRegistrationStatus]:
        await self.ensure_workspace_exists(session, workspace_id)
        # ``list_for_workspace`` already orders global-before-workspace and
        # builtin-before-custom, which is exactly the precedence the merge below
        # relies on: assigning into ``merged`` in that order lets a workspace row
        # (and a custom row) overwrite the global/builtin it shadows.
        rows = await self.status_repo.list_for_workspace(session, workspace_id=workspace_id)
        merged: dict[tuple[str, str], models.BalancerRegistrationStatus] = {}
        for row in rows:
            merged[(row.scope, row.slug)] = row
        return sorted(
            merged.values(),
            key=lambda item: (
                item.scope,
                0 if item.kind == "builtin" else 1,
                item.name.lower(),
                item.id,
            ),
        )

    async def list_custom_statuses(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> list[models.BalancerRegistrationStatus]:
        await self.ensure_workspace_exists(session, workspace_id)
        result = await session.execute(
            self.status_repo.select()
            .where(
                models.BalancerRegistrationStatus.workspace_id == workspace_id,
                models.BalancerRegistrationStatus.kind == "custom",
            )
            .order_by(
                models.BalancerRegistrationStatus.scope.asc(),
                models.BalancerRegistrationStatus.name.asc(),
                models.BalancerRegistrationStatus.id.asc(),
            )
        )
        return list(result.scalars().all())

    async def get_custom_status_by_id(
        self,
        session: AsyncSession,
        workspace_id: int,
        status_id: int,
    ) -> models.BalancerRegistrationStatus:
        status_row = await self.status_repo.get_by(
            session,
            id=status_id,
            workspace_id=workspace_id,
            kind="custom",
        )
        if status_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Custom status not found",
            )
        return status_row

    async def get_builtin_canonical_status(
        self,
        session: AsyncSession,
        *,
        scope: StatusScope,
        slug: str,
    ) -> models.BalancerRegistrationStatus:
        status_row = await self.status_repo.get_by_slug(
            session,
            workspace_id=None,
            scope=scope,
            slug=slug,
            kind="builtin",
        )
        if status_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Built-in status not found",
            )
        return status_row

    async def _ensure_custom_slug_available(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        scope: StatusScope,
        slug: str,
        exclude_status_id: int | None = None,
    ) -> None:
        if slug in get_builtin_status_values(scope):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Slug '{slug}' is reserved for a built-in {scope} status",
            )

        filters: list[sa.ColumnElement[bool]] = [
            models.BalancerRegistrationStatus.workspace_id == workspace_id,
            models.BalancerRegistrationStatus.scope == scope,
            models.BalancerRegistrationStatus.slug == slug,
        ]
        if exclude_status_id is not None:
            filters.append(models.BalancerRegistrationStatus.id != exclude_status_id)

        if await self.status_repo.exists(session, filters=filters):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Slug '{slug}' already exists in workspace",
            )

    async def create_custom_status(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        scope: StatusScope,
        icon_slug: str | None,
        icon_color: str | None,
        name: str,
        description: str | None,
        excludes_from_balancer: bool = False,
        excludes_from_ready: bool = False,
    ) -> models.BalancerRegistrationStatus:
        await self.ensure_workspace_exists(session, workspace_id)
        slug = _normalize_name_to_slug(name)
        await self._ensure_custom_slug_available(
            session,
            workspace_id=workspace_id,
            scope=scope,
            slug=slug,
        )
        status_row = models.BalancerRegistrationStatus(
            workspace_id=workspace_id,
            scope=scope,
            slug=slug,
            kind="custom",
            icon_slug=icon_slug,
            icon_color=icon_color,
            name=name.strip(),
            description=description.strip() if description else None,
            # Only meaningful for scope == "balancer"; harmless (unused) otherwise.
            excludes_from_balancer=excludes_from_balancer,
            excludes_from_ready=excludes_from_ready,
        )
        await self.status_repo.create(session, status_row)
        await session.commit()
        await invalidate_status_metas_cache(workspace_id)
        await session.refresh(status_row)
        return status_row

    async def update_custom_status(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        status_id: int,
        icon_slug: str | None,
        icon_color: str | None,
        name: str | None,
        description: str | None,
        excludes_from_balancer: bool | None = None,
        excludes_from_ready: bool | None = None,
    ) -> models.BalancerRegistrationStatus:
        status_row = await self.get_custom_status_by_id(session, workspace_id, status_id)

        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Status name must not be empty",
                )
            status_row.name = normalized_name
        if icon_slug is not None:
            status_row.icon_slug = icon_slug or None
        if icon_color is not None:
            status_row.icon_color = icon_color or None
        if description is not None:
            status_row.description = description.strip() or None
        if excludes_from_balancer is not None:
            status_row.excludes_from_balancer = excludes_from_balancer
        if excludes_from_ready is not None:
            status_row.excludes_from_ready = excludes_from_ready

        await session.commit()
        await invalidate_status_metas_cache(workspace_id)
        await session.refresh(status_row)
        return status_row

    async def delete_custom_status(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        status_id: int,
    ) -> None:
        status_row = await self.get_custom_status_by_id(session, workspace_id, status_id)
        registration_column = (
            models.BalancerRegistration.status
            if status_row.scope == "registration"
            else models.BalancerRegistration.balancer_status
        )
        # Analytical: BalancerRegistration has no denormalized workspace_id column —
        # scope via the owning tournament (registrations are always tournament-scoped).
        in_use = await session.scalar(
            sa.select(sa.func.count(models.BalancerRegistration.id))
            .join(models.Tournament, models.Tournament.id == models.BalancerRegistration.tournament_id)
            .where(
                models.Tournament.workspace_id == workspace_id,
                registration_column == status_row.slug,
            )
        )
        if in_use:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Custom status is in use by registrations and cannot be deleted",
            )

        await self.status_repo.delete(session, status_row)
        await session.commit()
        await invalidate_status_metas_cache(workspace_id)

    async def upsert_builtin_override(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        scope: StatusScope,
        slug: str,
        icon_slug: str | None,
        icon_color: str | None,
        name: str | None,
        description: str | None,
    ) -> models.BalancerRegistrationStatus:
        await self.ensure_workspace_exists(session, workspace_id)
        if slug not in get_builtin_status_values(scope):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Slug '{slug}' is not a built-in {scope} status",
            )
        canonical = await self.get_builtin_canonical_status(session, scope=scope, slug=slug)
        status_row = await self.status_repo.get_by_slug(
            session,
            workspace_id=workspace_id,
            scope=scope,
            slug=slug,
            kind="builtin",
        )
        is_new = status_row is None
        if status_row is None:
            status_row = models.BalancerRegistrationStatus(
                workspace_id=workspace_id,
                scope=scope,
                slug=slug,
                kind="builtin",
                icon_slug=canonical.icon_slug,
                icon_color=canonical.icon_color,
                name=canonical.name,
                description=canonical.description,
            )

        if icon_slug is not None:
            status_row.icon_slug = icon_slug or None
        if icon_color is not None:
            status_row.icon_color = icon_color or None
        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Status name must not be empty",
                )
            status_row.name = normalized_name
        if description is not None:
            status_row.description = description.strip() or None

        # Persisted after the field edits so a fresh override is still ONE insert,
        # exactly as the previous ``session.add`` + single ``commit`` behaved.
        if is_new:
            await self.status_repo.create(session, status_row)
        await session.commit()
        await invalidate_status_metas_cache(workspace_id)
        await session.refresh(status_row)
        return status_row

    async def reset_builtin_override(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        scope: StatusScope,
        slug: str,
    ) -> None:
        status_row = await self.status_repo.get_by_slug(
            session,
            workspace_id=workspace_id,
            scope=scope,
            slug=slug,
            kind="builtin",
        )
        if status_row is None:
            return
        await self.status_repo.delete(session, status_row)
        await session.commit()
        await invalidate_status_metas_cache(workspace_id)


status_catalog_service = RegistrationStatusCatalogService()
