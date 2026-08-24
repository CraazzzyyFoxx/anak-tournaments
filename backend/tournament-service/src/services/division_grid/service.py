from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core.errors import BaseAPIException as HTTPException
from shared.division_grid import DEFAULT_GRID
from shared.repository import (
    DivisionGridMappingRepository,
    DivisionGridMappingRuleRepository,
    DivisionGridRepository,
    DivisionGridTierRepository,
    DivisionGridVersionRepository,
    TournamentRepository,
    WorkspaceRepository,
)
from shared.services import division_grid_cache
from shared.services.division_grid_access import get_workspace_source_version_ids
from src import models, schemas
from src.domain.division_grid import automap

__all__ = (
    "DivisionGridService",
    "SaveOutcome",
    "division_grid_service",
    "get_default_ow2_tiers_write",
)

_GRID_OPTIONS = (selectinload(models.DivisionGrid.versions).selectinload(models.DivisionGridVersion.tiers),)
_VERSION_OPTIONS = (
    selectinload(models.DivisionGridVersion.tiers),
    selectinload(models.DivisionGridVersion.grid),
)
_VERSION_TIERS_OPTIONS = (selectinload(models.DivisionGridVersion.tiers),)
_MAPPING_OPTIONS = (selectinload(models.DivisionGridMapping.rules),)


def _validate_version_payload(tiers: list[schemas.DivisionGridTierWrite]) -> None:
    if not tiers:
        raise HTTPException(status_code=400, detail="Division grid version must contain at least one tier")

    seen_slugs: set[str] = set()
    seen_sort_orders: set[int] = set()
    open_ended_count = 0
    for tier in tiers:
        if tier.slug in seen_slugs:
            raise HTTPException(status_code=400, detail=f"Duplicate tier slug: {tier.slug}")
        if tier.sort_order in seen_sort_orders:
            raise HTTPException(status_code=400, detail=f"Duplicate sort_order: {tier.sort_order}")
        seen_slugs.add(tier.slug)
        seen_sort_orders.add(tier.sort_order)
        if tier.rank_max is None:
            open_ended_count += 1
        elif tier.rank_min > tier.rank_max:
            raise HTTPException(status_code=400, detail=f"Invalid rank range for tier {tier.slug}")

    if open_ended_count > 1:
        raise HTTPException(status_code=400, detail="Only one tier may have an open-ended rank_max")


# Fields that do NOT affect runtime normalization (which keys on tier id + rank
# range). Editing only these on the active version is applied in place; anything
# else is "structural" and spawns a new version + remapping.
_STRUCTURAL_TIER_FIELDS = ("rank_min", "rank_max")


def _classify_tier_change(
    active_tiers: list,
    payload_tiers: list[schemas.DivisionGridTierWrite],
) -> str:
    """Return "cosmetic" or "structural" for a desired tier set vs the active one."""
    payload_ids = [tier.id for tier in payload_tiers]
    if any(tier_id is None for tier_id in payload_ids):
        return "structural"

    active_by_id = {tier.id: tier for tier in active_tiers}
    if set(payload_ids) != set(active_by_id):
        return "structural"

    for payload_tier in payload_tiers:
        active_tier = active_by_id[payload_tier.id]
        if any(getattr(active_tier, field) != getattr(payload_tier, field) for field in _STRUCTURAL_TIER_FIELDS):
            return "structural"
    return "cosmetic"


def get_default_ow2_tiers_write() -> list[schemas.DivisionGridTierWrite]:
    """Project the in-code default grid into this service's write DTO.

    The ladder itself lives in :data:`shared.domain.ow_ladder.LADDER` and reaches
    here through ``DEFAULT_GRID``; nothing about it is re-derived. The DTO's only
    extra field is ``sort_order``, which is the tier's position in the grid — and
    ``DEFAULT_GRID.tiers`` is ordered top-first, so position and ``number`` agree.
    """
    return [
        schemas.DivisionGridTierWrite(
            slug=tier.slug or f"division-{tier.number}",
            number=tier.number,
            name=tier.name,
            sort_order=index,
            rank_min=tier.rank_min,
            rank_max=tier.rank_max,
            icon_url=tier.icon_url,
            ow_rank_min=tier.ow_rank_min,
            ow_rank_max=tier.ow_rank_max,
        )
        for index, tier in enumerate(DEFAULT_GRID.tiers)
    ]


def _validate_mapping(
    source_tier_ids: set[int],
    rules: list[schemas.DivisionGridMappingRuleWrite],
    *,
    require_full_coverage: bool = True,
) -> bool:
    """Validate mapping rules; return whether the mapping is complete.

    With ``require_full_coverage`` (the default, used by the public upsert), a
    partial mapping raises 400. Auto-mapping passes ``False`` so it can persist
    an incomplete mapping (``is_complete=False``) with the resolvable rules,
    leaving the conflict tiers for the resolver.
    """
    if not rules:
        return not source_tier_ids

    by_source: dict[int, list[schemas.DivisionGridMappingRuleWrite]] = defaultdict(list)
    for rule in rules:
        by_source[rule.source_tier_id].append(rule)

    missing = source_tier_ids - set(by_source.keys())
    if missing and require_full_coverage:
        raise HTTPException(status_code=400, detail=f"Missing mapping rules for source tiers: {sorted(missing)}")

    for source_tier_id, tier_rules in by_source.items():
        total_weight = round(sum(rule.weight for rule in tier_rules), 6)
        if abs(total_weight - 1.0) > 0.000001:
            raise HTTPException(
                status_code=400,
                detail=f"Mapping weights for source tier {source_tier_id} must sum to 1.0",
            )
        if len(tier_rules) > 1 and not any(rule.is_primary for rule in tier_rules):
            raise HTTPException(
                status_code=400,
                detail=f"Multi-target mapping for source tier {source_tier_id} requires a primary rule",
            )
    return not missing


@dataclass
class SaveOutcome:
    mode: str  # "in_place" | "new_version_activated" | "new_version_pending"
    grid: models.DivisionGrid
    active_version_id: int | None
    saved_version_id: int
    readiness: schemas.DivisionGridActivationReadiness


def _pick_active_version(grid: models.DivisionGrid, workspace: models.Workspace) -> models.DivisionGridVersion | None:
    default_id = workspace.default_division_grid_version_id
    versions = list(grid.versions)
    for version in versions:
        if version.id == default_id:
            return version
    return max(versions, key=lambda version: version.version, default=None)


class DivisionGridService:
    """Grid / version / tier / mapping lifecycle for a workspace's division grids."""

    def __init__(
        self,
        *,
        grid_repo: DivisionGridRepository = DivisionGridRepository(),
        version_repo: DivisionGridVersionRepository = DivisionGridVersionRepository(),
        tier_repo: DivisionGridTierRepository = DivisionGridTierRepository(),
        mapping_repo: DivisionGridMappingRepository = DivisionGridMappingRepository(),
        rule_repo: DivisionGridMappingRuleRepository = DivisionGridMappingRuleRepository(),
        workspace_repo: WorkspaceRepository = WorkspaceRepository(),
        tournament_repo: TournamentRepository = TournamentRepository(),
    ) -> None:
        self.grid_repo = grid_repo
        self.version_repo = version_repo
        self.tier_repo = tier_repo
        self.mapping_repo = mapping_repo
        self.rule_repo = rule_repo
        self.workspace_repo = workspace_repo
        self.tournament_repo = tournament_repo

    async def get_workspace_grids(self, session: AsyncSession, workspace_id: int) -> list[models.DivisionGrid]:
        # Not DivisionGridRepository.list_workspace_grids: that one eager-loads
        # versions only, and DivisionGridRead needs the tiers underneath them.
        result = await session.execute(
            self.grid_repo.select()
            .options(*_GRID_OPTIONS)
            .where(models.DivisionGrid.workspace_id == workspace_id)
            .order_by(models.DivisionGrid.id.asc())
        )
        return list(result.scalars().unique().all())

    async def seed_default_grid_version(
        self,
        session: AsyncSession,
        workspace_id: int,
        grid_id: int,
    ) -> models.DivisionGridVersion:
        data = schemas.DivisionGridVersionCreate(
            label="Default Overwatch 2 Grid",
            tiers=get_default_ow2_tiers_write(),
        )
        version = await self.create_version(session, workspace_id, grid_id, data)
        await self.version_repo.update_fields(
            session,
            version,
            {"status": "published", "published_at": sa.func.now()},
        )
        await division_grid_cache.invalidate_grid_version(version.id)
        return version

    async def create_grid(
        self,
        session: AsyncSession,
        workspace_id: int,
        data: schemas.DivisionGridCreate,
    ) -> models.DivisionGrid:
        if await self.grid_repo.exists(session, workspace_id=workspace_id, slug=data.slug):
            raise HTTPException(status_code=400, detail="Division grid slug already exists in workspace")

        grid = await self.grid_repo.create(
            session,
            models.DivisionGrid(
                workspace_id=workspace_id,
                slug=data.slug,
                name=data.name,
                description=data.description,
            ),
        )

        # Auto-seed default Overwatch 2 division grid
        await self.seed_default_grid_version(session, workspace_id, grid.id)

        # Reload/refresh the grid relationship
        await session.refresh(grid)
        return grid

    async def get_grid(self, session: AsyncSession, workspace_id: int, grid_id: int) -> models.DivisionGrid:
        grid = await self.grid_repo.get_by(
            session,
            options=_GRID_OPTIONS,
            id=grid_id,
            workspace_id=workspace_id,
        )
        if grid is None:
            raise HTTPException(status_code=404, detail="Division grid not found")
        return grid

    async def get_grid_by_id(self, session: AsyncSession, grid_id: int) -> models.DivisionGrid:
        grid = await self.grid_repo.get(session, grid_id, options=_GRID_OPTIONS)
        if grid is None:
            raise HTTPException(status_code=404, detail="Division grid not found")
        return grid

    async def update_grid(
        self,
        session: AsyncSession,
        *,
        grid_id: int,
        data: schemas.DivisionGridUpdate,
    ) -> models.DivisionGrid:
        grid = await self.get_grid_by_id(session, grid_id)
        if grid.workspace_id is None:
            raise HTTPException(status_code=409, detail="System division grids cannot be modified")

        changes = data.model_dump(exclude_unset=True)
        archived = changes.pop("archived", None)
        if archived is True:
            active_version_id = await session.scalar(
                sa.select(models.Workspace.default_division_grid_version_id).where(
                    models.Workspace.id == grid.workspace_id
                )
            )
            if active_version_id in {version.id for version in grid.versions}:
                raise HTTPException(
                    status_code=409,
                    detail="The workspace default division grid cannot be archived",
                )
            grid.archived_at = datetime.now(UTC)
        elif archived is False:
            grid.archived_at = None

        await self.grid_repo.update_fields(session, grid, changes)
        return await self.get_grid_by_id(session, grid_id)

    async def delete_grid(self, session: AsyncSession, grid_id: int, *, force: bool = False) -> None:
        """Hard-delete a division grid and its versions/tiers/mappings (FK cascade).

        Without ``force``: refuses the workspace default and any grid whose versions
        are pinned by a tournament. With ``force``: those guards are skipped — the
        workspace default is cleared and pinned tournaments are detached (FK SET
        NULL) — but system grids (``workspace_id IS NULL``) are never deletable.
        """
        grid = await self.get_grid_by_id(session, grid_id)
        if grid.workspace_id is None:
            raise HTTPException(status_code=409, detail="System division grids cannot be deleted")

        version_ids = [version.id for version in grid.versions]
        if version_ids and not force:
            default_version_id = await session.scalar(
                sa.select(models.Workspace.default_division_grid_version_id).where(
                    models.Workspace.id == grid.workspace_id
                )
            )
            if default_version_id in version_ids:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot delete the workspace default division grid",
                )
            tournament_uses = await self.tournament_repo.count(
                session,
                filters=[models.Tournament.division_grid_version_id.in_(version_ids)],
            )
            if tournament_uses:
                raise HTTPException(
                    status_code=409,
                    detail=f"Cannot delete grid: {tournament_uses} tournament(s) use its versions",
                )

        if force:
            # Clear the workspace default if it points into this grid so the delete
            # does not depend on DB-side SET NULL timing; pinned tournaments are
            # detached by the FK ON DELETE SET NULL when the versions are removed.
            await self.workspace_repo.clear_default_grid_version(
                session,
                workspace_id=grid.workspace_id,
                version_ids=version_ids,
            )

        for version_id in version_ids:
            await division_grid_cache.invalidate_grid_version(version_id)
        await division_grid_cache.invalidate_workspace(grid.workspace_id)
        await self.grid_repo.delete(session, grid)

    async def get_versions(
        self,
        session: AsyncSession,
        workspace_id: int,
        grid_id: int,
    ) -> list[models.DivisionGridVersion]:
        # The workspace guard is get_grid's 404; the version query needs no second
        # join back onto division_grid to re-prove ownership.
        await self.get_grid(session, workspace_id, grid_id)
        versions = await self.version_repo.list_by_grid(session, grid_id, options=_VERSION_TIERS_OPTIONS)
        return list(versions)

    async def create_version(
        self,
        session: AsyncSession,
        workspace_id: int,
        grid_id: int,
        data: schemas.DivisionGridVersionCreate,
        *,
        created_from_version_id: int | None = None,
    ) -> models.DivisionGridVersion:
        grid = await self.get_grid(session, workspace_id, grid_id)
        _validate_version_payload(data.tiers)

        next_version = await self.version_repo.get_next_version(session, grid.id)
        version = await self.version_repo.create(
            session,
            models.DivisionGridVersion(
                grid_id=grid.id,
                version=next_version,
                label=data.label,
                status="draft",
                created_from_version_id=created_from_version_id,
            ),
        )

        await self.tier_repo.create_many(
            session,
            [
                models.DivisionGridTier(
                    version_id=version.id,
                    slug=tier.slug,
                    number=tier.number,
                    name=tier.name,
                    sort_order=tier.sort_order,
                    rank_min=tier.rank_min,
                    rank_max=tier.rank_max,
                    icon_url=tier.icon_url,
                    ow_rank_min=tier.ow_rank_min,
                    ow_rank_max=tier.ow_rank_max,
                )
                for tier in data.tiers
            ],
        )

        created = await self.get_version(session, version.id)
        await division_grid_cache.invalidate_grid_version(created.id)
        return created

    async def get_version(self, session: AsyncSession, version_id: int) -> models.DivisionGridVersion:
        version = await self.version_repo.get(session, version_id, options=_VERSION_OPTIONS)
        if version is None:
            raise HTTPException(status_code=404, detail="Division grid version not found")
        return version

    async def delete_version(self, session: AsyncSession, version_id: int) -> None:
        version = await self.get_version(session, version_id)

        workspace_uses = await self.workspace_repo.count(
            session,
            filters=[models.Workspace.default_division_grid_version_id == version_id],
        )
        if workspace_uses:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete version: it is set as the workspace default",
            )

        tournament_uses = await self.tournament_repo.count(
            session,
            filters=[models.Tournament.division_grid_version_id == version_id],
        )
        if tournament_uses:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot delete version: used by {tournament_uses} tournament(s)",
            )

        await division_grid_cache.invalidate_grid_version(version_id)
        await self.version_repo.delete(session, version)

    async def publish_version(self, session: AsyncSession, version_id: int) -> models.DivisionGridVersion:
        version = await self.get_version(session, version_id)
        await self.version_repo.update_fields(
            session,
            version,
            {"status": "published", "published_at": sa.func.now()},
        )
        await division_grid_cache.invalidate_grid_version(version_id)
        return await self.get_version(session, version_id)

    async def update_version(
        self,
        session: AsyncSession,
        version_id: int,
        data: schemas.DivisionGridVersionUpdate,
    ) -> models.DivisionGridVersion:
        version = await self.get_version(session, version_id)
        if version.status == "published":
            raise HTTPException(
                status_code=409,
                detail="Published division grid versions are immutable; create a draft instead",
            )

        if data.label is not None:
            version.label = data.label
        if data.tiers is not None:
            _validate_version_payload(data.tiers)
            existing_by_id = {tier.id: tier for tier in version.tiers}
            payload_ids = [tier.id for tier in data.tiers if tier.id is not None]
            if len(payload_ids) != len(set(payload_ids)):
                raise HTTPException(status_code=400, detail="Duplicate tier id in division grid payload")
            unknown_ids = set(payload_ids) - set(existing_by_id)
            if unknown_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Tier ids do not belong to division grid version {version_id}: {sorted(unknown_ids)}",
                )

            structural_fields = ("slug", "number", "rank_min", "rank_max")
            structural_changed = False
            removed_ids = set(existing_by_id) - set(payload_ids)
            if removed_ids or len(payload_ids) != len(data.tiers):
                structural_changed = True

            reordered = any(
                tier.id is not None and existing_by_id[tier.id].sort_order != tier.sort_order for tier in data.tiers
            )
            if reordered:
                for existing in version.tiers:
                    existing.sort_order = -int(existing.id)
                await session.flush()

            added_tiers: list[models.DivisionGridTier] = []
            for tier_data in data.tiers:
                if tier_data.id is None:
                    added_tiers.append(
                        models.DivisionGridTier(
                            version_id=version_id,
                            slug=tier_data.slug,
                            number=tier_data.number,
                            name=tier_data.name,
                            sort_order=tier_data.sort_order,
                            rank_min=tier_data.rank_min,
                            rank_max=tier_data.rank_max,
                            icon_url=tier_data.icon_url,
                            ow_rank_min=tier_data.ow_rank_min,
                            ow_rank_max=tier_data.ow_rank_max,
                        )
                    )
                    continue

                existing = existing_by_id[tier_data.id]
                structural_changed = structural_changed or any(
                    getattr(existing, field) != getattr(tier_data, field) for field in structural_fields
                )
                existing.slug = tier_data.slug
                existing.number = tier_data.number
                existing.name = tier_data.name
                existing.sort_order = tier_data.sort_order
                existing.rank_min = tier_data.rank_min
                existing.rank_max = tier_data.rank_max
                existing.icon_url = tier_data.icon_url
                existing.ow_rank_min = tier_data.ow_rank_min
                existing.ow_rank_max = tier_data.ow_rank_max

            if added_tiers:
                await self.tier_repo.create_many(session, added_tiers)

            for removed_id in removed_ids:
                await self.tier_repo.delete(session, existing_by_id[removed_id])

            if structural_changed:
                await self.mapping_repo.mark_incomplete_for_version(session, version_id)

        await session.flush()
        updated = await self.get_version(session, version_id)
        await division_grid_cache.invalidate_grid_version(version_id)
        return updated

    async def clone_version(
        self,
        session: AsyncSession,
        version_id: int,
        *,
        label: str | None = None,
    ) -> models.DivisionGridVersion:
        version = await self.get_version(session, version_id)
        return await self.create_version(
            session,
            version.grid.workspace_id,
            version.grid_id,
            schemas.DivisionGridVersionCreate(
                label=label or f"{version.label} Copy",
                tiers=[
                    schemas.DivisionGridTierWrite(
                        slug=tier.slug,
                        number=tier.number,
                        name=tier.name,
                        sort_order=tier.sort_order,
                        rank_min=tier.rank_min,
                        rank_max=tier.rank_max,
                        icon_url=tier.icon_url,
                        ow_rank_min=tier.ow_rank_min,
                        ow_rank_max=tier.ow_rank_max,
                    )
                    for tier in version.tiers
                ],
            ),
            created_from_version_id=version.id,
        )

    async def get_mapping(
        self,
        session: AsyncSession,
        source_version_id: int,
        target_version_id: int,
    ) -> models.DivisionGridMapping | None:
        return await self.mapping_repo.get_for_versions(
            session,
            source_version_id=source_version_id,
            target_version_id=target_version_id,
            options=_MAPPING_OPTIONS,
        )

    async def get_activation_readiness(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        target_version_id: int,
    ) -> schemas.DivisionGridActivationReadiness:
        target = await self.get_version(session, target_version_id)
        if target.grid.workspace_id not in (None, workspace_id):
            raise HTTPException(
                status_code=400,
                detail="Target division grid version does not belong to the workspace",
            )

        used_source_ids = await get_workspace_source_version_ids(session, workspace_id)
        used_source_ids.add(target_version_id)
        missing: list[int] = []
        incomplete: list[int] = []
        sources: list[schemas.DivisionGridReadinessSource] = []
        for source_version_id in sorted(used_source_ids):
            if source_version_id == target_version_id:
                continue
            source_version = await self.get_version(session, source_version_id)
            mapping = await self.get_mapping(session, source_version_id, target_version_id)
            covered = {rule.source_tier_id for rule in mapping.rules} if mapping is not None else set()
            if mapping is None:
                status = "missing"
                missing.append(source_version_id)
            elif not mapping.is_complete:
                status = "incomplete"
                incomplete.append(source_version_id)
            else:
                status = "ok"
            conflict_tiers = (
                []
                if status == "ok"
                else [
                    schemas.DivisionGridReadinessConflictTier(source_tier_id=tier.id, slug=tier.slug, name=tier.name)
                    for tier in source_version.tiers
                    if tier.id not in covered
                ]
            )
            tournament_count = await self.tournament_repo.count(
                session,
                filters=[models.Tournament.division_grid_version_id == source_version_id],
            )
            tournament_names = list(
                await session.scalars(
                    sa.select(models.Tournament.name)
                    .where(models.Tournament.division_grid_version_id == source_version_id)
                    .order_by(models.Tournament.id.desc())
                    .limit(5)
                )
            )
            sources.append(
                schemas.DivisionGridReadinessSource(
                    version_id=source_version_id,
                    version_label=source_version.label,
                    grid_name=source_version.grid.name,
                    tournament_count=tournament_count,
                    tournament_names=tournament_names,
                    status=status,
                    conflict_tiers=conflict_tiers,
                )
            )

        return schemas.DivisionGridActivationReadiness(
            target_version_id=target_version_id,
            is_ready=not missing and not incomplete,
            used_source_version_ids=sorted(used_source_ids),
            missing_mapping_version_ids=missing,
            incomplete_mapping_version_ids=incomplete,
            sources=sources,
        )

    async def activate_version(
        self,
        session: AsyncSession,
        *,
        workspace: models.Workspace,
        version_id: int,
    ) -> models.DivisionGridVersion:
        version = await self.get_version(session, version_id)
        if version.grid.workspace_id not in (None, workspace.id):
            raise HTTPException(
                status_code=400,
                detail="Division grid version does not belong to the workspace",
            )
        if version.status != "published":
            raise HTTPException(status_code=409, detail="Only published division grid versions can be activated")

        readiness = await self.get_activation_readiness(
            session,
            workspace_id=workspace.id,
            target_version_id=version_id,
        )
        if not readiness.is_ready:
            blocked = sorted(set(readiness.missing_mapping_version_ids) | set(readiness.incomplete_mapping_version_ids))
            raise HTTPException(
                status_code=409,
                detail=f"Division grid mappings are not ready for source versions: {blocked}",
            )

        await self.workspace_repo.update_fields(
            session,
            workspace,
            {"default_division_grid_version_id": version_id},
        )
        await division_grid_cache.invalidate_workspace(workspace.id)
        return version

    async def upsert_mapping(
        self,
        session: AsyncSession,
        source_version_id: int,
        target_version_id: int,
        data: schemas.DivisionGridMappingWrite,
    ) -> models.DivisionGridMapping:
        source_version = await self.get_version(session, source_version_id)
        await self.get_version(session, target_version_id)

        source_tier_ids = {tier.id for tier in source_version.tiers}
        target_tier_ids = {rule.target_tier_id for rule in data.rules}
        source_rule_tier_ids = {rule.source_tier_id for rule in data.rules}
        if source_rule_tier_ids - source_tier_ids:
            raise HTTPException(status_code=400, detail="Mapping contains source tiers outside the source version")

        valid_target_ids = set(await self.tier_repo.list_ids_by_version(session, target_version_id))
        if target_tier_ids - valid_target_ids:
            raise HTTPException(status_code=400, detail="Mapping contains target tiers outside the target version")

        is_complete = _validate_mapping(source_tier_ids, data.rules)
        return await self._persist_mapping(
            session,
            source_version_id=source_version_id,
            target_version_id=target_version_id,
            name=data.name,
            rules=data.rules,
            is_complete=is_complete,
        )

    async def _persist_mapping(
        self,
        session: AsyncSession,
        *,
        source_version_id: int,
        target_version_id: int,
        name: str,
        rules: list[schemas.DivisionGridMappingRuleWrite],
        is_complete: bool,
    ) -> models.DivisionGridMapping:
        """Write a mapping row + rules (replacing any existing rules), WITHOUT the
        full-coverage check — callers decide ``is_complete``. Used by both the
        validated public upsert and the auto-mapper (which may store partials)."""
        mapping = await self.get_mapping(session, source_version_id, target_version_id)
        if mapping is None:
            mapping = await self.mapping_repo.create(
                session,
                models.DivisionGridMapping(
                    source_version_id=source_version_id,
                    target_version_id=target_version_id,
                    name=name,
                    is_complete=is_complete,
                ),
            )
        else:
            await self.mapping_repo.update_fields(session, mapping, {"name": name, "is_complete": is_complete})
            await self.rule_repo.delete_for_mapping(session, mapping.id)
            await session.flush()

        await self.rule_repo.create_many(
            session,
            [
                models.DivisionGridMappingRule(
                    mapping_id=mapping.id,
                    source_tier_id=rule.source_tier_id,
                    target_tier_id=rule.target_tier_id,
                    weight=rule.weight,
                    is_primary=rule.is_primary,
                )
                for rule in rules
            ],
        )
        refreshed = await self.get_mapping(session, source_version_id, target_version_id)
        if refreshed is None:
            raise HTTPException(status_code=500, detail="Failed to persist division grid mapping")
        await division_grid_cache.invalidate_mapping(source_version_id, target_version_id)
        return refreshed

    async def _resolve_workspace_grid(
        self,
        session: AsyncSession,
        workspace: models.Workspace,
    ) -> models.DivisionGrid:
        """The single managed grid for a workspace: the one holding the active
        version, else the newest non-archived, else a freshly seeded grid."""
        grids = await self.get_workspace_grids(session, workspace.id)
        default_id = workspace.default_division_grid_version_id
        if default_id is not None:
            for grid in grids:
                if any(version.id == default_id for version in grid.versions):
                    return grid
        live = [grid for grid in grids if grid.archived_at is None]
        if live:
            return max(live, key=lambda grid: grid.id)
        if grids:
            return max(grids, key=lambda grid: grid.id)
        return await self.create_grid(
            session,
            workspace.id,
            schemas.DivisionGridCreate(slug="default", name="Division Grid"),
        )

    async def _apply_cosmetic(
        self,
        session: AsyncSession,
        version: models.DivisionGridVersion,
        payload_tiers: list[schemas.DivisionGridTierWrite],
    ) -> None:
        """Apply cosmetic-only tier edits in place (no rank/count changes)."""
        by_id = {tier.id: tier for tier in version.tiers}
        if any(by_id[p.id].sort_order != p.sort_order for p in payload_tiers):
            # Park sort_order in a non-colliding range before reassigning to avoid
            # transient (version_id, sort_order) unique violations.
            for tier in version.tiers:
                tier.sort_order = -int(tier.id)
            await session.flush()
        for payload_tier in payload_tiers:
            tier = by_id[payload_tier.id]
            tier.slug = payload_tier.slug
            tier.number = payload_tier.number
            tier.name = payload_tier.name
            tier.sort_order = payload_tier.sort_order
            tier.icon_url = payload_tier.icon_url
            tier.ow_rank_min = payload_tier.ow_rank_min
            tier.ow_rank_max = payload_tier.ow_rank_max
        await session.flush()
        await division_grid_cache.invalidate_grid_version(version.id)

    async def save_workspace_grid(
        self,
        session: AsyncSession,
        *,
        workspace: models.Workspace,
        data: schemas.DivisionGridSaveRequest,
    ) -> SaveOutcome:
        """Server-authoritative grid save: classify the edit, then either apply it
        in place (cosmetic) or spawn a new version, auto-generate mappings from every
        used source version, and auto-activate when the mappings are complete."""
        if data.grid_id is not None:
            grid = await self.get_grid_by_id(session, data.grid_id)
            if grid.workspace_id not in (None, workspace.id):
                raise HTTPException(status_code=400, detail="Division grid does not belong to the workspace")
        else:
            grid = await self._resolve_workspace_grid(session, workspace)
        active = _pick_active_version(grid, workspace)
        change = "structural" if active is None else _classify_tier_change(active.tiers, data.tiers)

        if change == "cosmetic" and active is not None:
            await self._apply_cosmetic(session, active, data.tiers)
            saved_version_id = active.id
            mode = "in_place"
        else:
            label = data.name or grid.name or f"Version {len(grid.versions) + 1}"
            new_version = await self.create_version(
                session,
                workspace.id,
                grid.id,
                schemas.DivisionGridVersionCreate(label=label, tiers=data.tiers),
            )
            await self.publish_version(session, new_version.id)

            source_ids = await get_workspace_source_version_ids(session, workspace.id)
            if active is not None:
                source_ids.add(active.id)
            source_ids.discard(new_version.id)
            for source_version_id in sorted(source_ids):
                source_version = await self.get_version(session, source_version_id)
                generation = automap.generate_mapping_rules(source_version.tiers, new_version.tiers)
                await self._persist_mapping(
                    session,
                    source_version_id=source_version_id,
                    target_version_id=new_version.id,
                    name=f"Auto: {source_version.label} \u2192 {new_version.label}",
                    rules=generation.rules,
                    is_complete=generation.is_complete,
                )

            readiness = await self.get_activation_readiness(
                session,
                workspace_id=workspace.id,
                target_version_id=new_version.id,
            )
            if readiness.is_ready:
                await self.activate_version(session, workspace=workspace, version_id=new_version.id)
                mode = "new_version_activated"
            else:
                mode = "new_version_pending"
            saved_version_id = new_version.id

        if data.name and grid.name != data.name:
            grid.name = data.name
        await session.flush()

        grid = await self.get_grid_by_id(session, grid.id)
        readiness = await self.get_activation_readiness(
            session,
            workspace_id=workspace.id,
            target_version_id=saved_version_id,
        )
        return SaveOutcome(
            mode=mode,
            grid=grid,
            active_version_id=workspace.default_division_grid_version_id,
            saved_version_id=saved_version_id,
            readiness=readiness,
        )


division_grid_service = DivisionGridService()
