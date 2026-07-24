from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core.errors import BaseAPIException as HTTPException
from shared.services import division_grid_cache
from shared.services.division_grid_access import get_workspace_source_version_ids
from src import models, schemas


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


async def get_workspace_grids(session: AsyncSession, workspace_id: int) -> list[models.DivisionGrid]:
    result = await session.execute(
        sa.select(models.DivisionGrid)
        .options(selectinload(models.DivisionGrid.versions).selectinload(models.DivisionGridVersion.tiers))
        .where(models.DivisionGrid.workspace_id == workspace_id)
        .order_by(models.DivisionGrid.id.asc())
    )
    return list(result.scalars().unique().all())


def get_default_ow2_tiers_write() -> list[schemas.DivisionGridTierWrite]:
    divisions = ["champion", "grandmaster", "master", "diamond", "platinum", "gold", "silver", "bronze"]
    bases = {
        "bronze": 1000,
        "silver": 1500,
        "gold": 2000,
        "platinum": 2500,
        "diamond": 3000,
        "master": 3500,
        "grandmaster": 4000,
        "champion": 4500,
    }

    tiers = []
    sort_order = 0
    number = 1

    for div in divisions:
        base = bases[div]
        for tier_num in range(1, 6):
            slug = f"{div}-{tier_num}"
            name = f"{div.capitalize()} {tier_num}"
            offset = (5 - tier_num) * 100
            rank_min = base + offset

            if div == "champion" and tier_num == 1:
                rank_max = None
            else:
                rank_max = rank_min + 99

            icon_url = f"https://minio.craazzzyyfoxx.me/aqt/assets/divisions/{slug}.png"

            tiers.append(
                schemas.DivisionGridTierWrite(
                    slug=slug,
                    number=number,
                    name=name,
                    sort_order=sort_order,
                    rank_min=rank_min,
                    rank_max=rank_max,
                    icon_url=icon_url,
                )
            )
            sort_order += 1
            number += 1

    return tiers


async def seed_default_grid_version(
    session: AsyncSession,
    workspace_id: int,
    grid_id: int,
) -> models.DivisionGridVersion:
    tiers_write = get_default_ow2_tiers_write()
    data = schemas.DivisionGridVersionCreate(
        label="Default Overwatch 2 Grid",
        tiers=tiers_write,
    )
    version = await create_version(session, workspace_id, grid_id, data)
    version.status = "published"
    version.published_at = sa.func.now()
    await session.flush()
    await division_grid_cache.invalidate_grid_version(version.id)
    return version


async def create_grid(
    session: AsyncSession,
    workspace_id: int,
    data: schemas.DivisionGridCreate,
) -> models.DivisionGrid:
    exists = await session.scalar(
        sa.select(models.DivisionGrid.id).where(
            models.DivisionGrid.workspace_id == workspace_id,
            models.DivisionGrid.slug == data.slug,
        )
    )
    if exists is not None:
        raise HTTPException(status_code=400, detail="Division grid slug already exists in workspace")

    grid = models.DivisionGrid(
        workspace_id=workspace_id,
        slug=data.slug,
        name=data.name,
        description=data.description,
    )
    session.add(grid)
    await session.flush()

    # Auto-seed default Overwatch 2 division grid
    await seed_default_grid_version(session, workspace_id, grid.id)

    # Reload/refresh the grid relationship
    await session.refresh(grid)
    return grid


async def get_grid(session: AsyncSession, workspace_id: int, grid_id: int) -> models.DivisionGrid:
    grid = await session.scalar(
        sa.select(models.DivisionGrid)
        .options(selectinload(models.DivisionGrid.versions).selectinload(models.DivisionGridVersion.tiers))
        .where(models.DivisionGrid.id == grid_id, models.DivisionGrid.workspace_id == workspace_id)
    )
    if grid is None:
        raise HTTPException(status_code=404, detail="Division grid not found")
    return grid


async def get_grid_by_id(session: AsyncSession, grid_id: int) -> models.DivisionGrid:
    grid = await session.scalar(
        sa.select(models.DivisionGrid)
        .options(selectinload(models.DivisionGrid.versions).selectinload(models.DivisionGridVersion.tiers))
        .where(models.DivisionGrid.id == grid_id)
    )
    if grid is None:
        raise HTTPException(status_code=404, detail="Division grid not found")
    return grid


async def update_grid(
    session: AsyncSession,
    *,
    grid_id: int,
    data: schemas.DivisionGridUpdate,
) -> models.DivisionGrid:
    grid = await get_grid_by_id(session, grid_id)
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

    for field, value in changes.items():
        setattr(grid, field, value)
    await session.flush()
    return await get_grid_by_id(session, grid_id)


async def get_versions(session: AsyncSession, workspace_id: int, grid_id: int) -> list[models.DivisionGridVersion]:
    await get_grid(session, workspace_id, grid_id)
    result = await session.execute(
        sa.select(models.DivisionGridVersion)
        .join(models.DivisionGrid, models.DivisionGrid.id == models.DivisionGridVersion.grid_id)
        .options(selectinload(models.DivisionGridVersion.tiers))
        .where(models.DivisionGrid.id == grid_id, models.DivisionGrid.workspace_id == workspace_id)
        .order_by(models.DivisionGridVersion.version.asc())
    )
    return list(result.scalars().unique().all())


async def create_version(
    session: AsyncSession,
    workspace_id: int,
    grid_id: int,
    data: schemas.DivisionGridVersionCreate,
    *,
    created_from_version_id: int | None = None,
) -> models.DivisionGridVersion:
    grid = await get_grid(session, workspace_id, grid_id)
    _validate_version_payload(data.tiers)

    max_version = await session.scalar(
        sa.select(sa.func.coalesce(sa.func.max(models.DivisionGridVersion.version), 0)).where(
            models.DivisionGridVersion.grid_id == grid.id
        )
    )
    version = models.DivisionGridVersion(
        grid_id=grid.id,
        version=int(max_version or 0) + 1,
        label=data.label,
        status="draft",
        created_from_version_id=created_from_version_id,
    )
    session.add(version)
    await session.flush()

    for tier in data.tiers:
        session.add(
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
        )

    await session.flush()
    created = await get_version(session, version.id)
    await division_grid_cache.invalidate_grid_version(created.id)
    return created


async def get_version(session: AsyncSession, version_id: int) -> models.DivisionGridVersion:
    version = await session.scalar(
        sa.select(models.DivisionGridVersion)
        .options(
            selectinload(models.DivisionGridVersion.tiers),
            selectinload(models.DivisionGridVersion.grid),
        )
        .where(models.DivisionGridVersion.id == version_id)
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Division grid version not found")
    return version


async def delete_version(session: AsyncSession, version_id: int) -> None:
    version = await get_version(session, version_id)

    workspace_uses = await session.scalar(
        sa.select(sa.func.count()).where(models.Workspace.default_division_grid_version_id == version_id)
    )
    if workspace_uses:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete version: it is set as the workspace default",
        )

    tournament_uses = await session.scalar(
        sa.select(sa.func.count()).where(models.Tournament.division_grid_version_id == version_id)
    )
    if tournament_uses:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete version: used by {tournament_uses} tournament(s)",
        )

    await division_grid_cache.invalidate_grid_version(version_id)
    await session.delete(version)
    await session.flush()


async def publish_version(session: AsyncSession, version_id: int) -> models.DivisionGridVersion:
    version = await get_version(session, version_id)
    version.status = "published"
    version.published_at = sa.func.now()
    await session.flush()
    await division_grid_cache.invalidate_grid_version(version_id)
    return await get_version(session, version_id)


async def update_version(
    session: AsyncSession,
    version_id: int,
    data: schemas.DivisionGridVersionUpdate,
) -> models.DivisionGridVersion:
    version = await get_version(session, version_id)
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
            tier.id is not None
            and existing_by_id[tier.id].sort_order != tier.sort_order
            for tier in data.tiers
        )
        if reordered:
            for existing in version.tiers:
                existing.sort_order = -int(existing.id)
            await session.flush()

        for tier_data in data.tiers:
            if tier_data.id is None:
                session.add(
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

        for removed_id in removed_ids:
            await session.delete(existing_by_id[removed_id])

        if structural_changed:
            await session.execute(
                sa.update(models.DivisionGridMapping)
                .where(
                    sa.or_(
                        models.DivisionGridMapping.source_version_id == version_id,
                        models.DivisionGridMapping.target_version_id == version_id,
                    )
                )
                .values(is_complete=False)
            )

    await session.flush()
    updated = await get_version(session, version_id)
    await division_grid_cache.invalidate_grid_version(version_id)
    return updated


async def clone_version(
    session: AsyncSession, version_id: int, *, label: str | None = None
) -> models.DivisionGridVersion:
    version = await get_version(session, version_id)
    cloned = await create_version(
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
    return cloned


def _validate_mapping(source_tier_ids: set[int], rules: list[schemas.DivisionGridMappingRuleWrite]) -> bool:
    if not rules:
        return False

    by_source: dict[int, list[schemas.DivisionGridMappingRuleWrite]] = defaultdict(list)
    for rule in rules:
        by_source[rule.source_tier_id].append(rule)

    if set(by_source.keys()) != source_tier_ids:
        missing = source_tier_ids - set(by_source.keys())
        if missing:
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
    return True


async def get_mapping(
    session: AsyncSession,
    source_version_id: int,
    target_version_id: int,
) -> models.DivisionGridMapping | None:
    return await session.scalar(
        sa.select(models.DivisionGridMapping)
        .options(selectinload(models.DivisionGridMapping.rules))
        .where(
            models.DivisionGridMapping.source_version_id == source_version_id,
            models.DivisionGridMapping.target_version_id == target_version_id,
        )
    )


async def get_activation_readiness(
    session: AsyncSession,
    *,
    workspace_id: int,
    target_version_id: int,
) -> schemas.DivisionGridActivationReadiness:
    target = await get_version(session, target_version_id)
    if target.grid.workspace_id not in (None, workspace_id):
        raise HTTPException(
            status_code=400,
            detail="Target division grid version does not belong to the workspace",
        )

    used_source_ids = await get_workspace_source_version_ids(session, workspace_id)
    used_source_ids.add(target_version_id)
    missing: list[int] = []
    incomplete: list[int] = []
    for source_version_id in sorted(used_source_ids):
        if source_version_id == target_version_id:
            continue
        mapping = await get_mapping(session, source_version_id, target_version_id)
        if mapping is None:
            missing.append(source_version_id)
        elif not mapping.is_complete:
            incomplete.append(source_version_id)

    return schemas.DivisionGridActivationReadiness(
        target_version_id=target_version_id,
        is_ready=not missing and not incomplete,
        used_source_version_ids=sorted(used_source_ids),
        missing_mapping_version_ids=missing,
        incomplete_mapping_version_ids=incomplete,
    )


async def activate_version(
    session: AsyncSession,
    *,
    workspace: models.Workspace,
    version_id: int,
) -> models.DivisionGridVersion:
    version = await get_version(session, version_id)
    if version.grid.workspace_id not in (None, workspace.id):
        raise HTTPException(
            status_code=400,
            detail="Division grid version does not belong to the workspace",
        )
    if version.status != "published":
        raise HTTPException(status_code=409, detail="Only published division grid versions can be activated")

    readiness = await get_activation_readiness(
        session,
        workspace_id=workspace.id,
        target_version_id=version_id,
    )
    if not readiness.is_ready:
        blocked = sorted(
            set(readiness.missing_mapping_version_ids)
            | set(readiness.incomplete_mapping_version_ids)
        )
        raise HTTPException(
            status_code=409,
            detail=f"Division grid mappings are not ready for source versions: {blocked}",
        )

    workspace.default_division_grid_version_id = version_id
    await session.flush()
    await division_grid_cache.invalidate_workspace(workspace.id)
    return version


async def upsert_mapping(
    session: AsyncSession,
    source_version_id: int,
    target_version_id: int,
    data: schemas.DivisionGridMappingWrite,
) -> models.DivisionGridMapping:
    source_version = await get_version(session, source_version_id)
    await get_version(session, target_version_id)

    source_tier_ids = {tier.id for tier in source_version.tiers}
    target_tier_ids = {rule.target_tier_id for rule in data.rules}
    source_rule_tier_ids = {rule.source_tier_id for rule in data.rules}
    if source_rule_tier_ids - source_tier_ids:
        raise HTTPException(status_code=400, detail="Mapping contains source tiers outside the source version")

    valid_target_ids = set(
        await session.scalars(
            sa.select(models.DivisionGridTier.id).where(models.DivisionGridTier.version_id == target_version_id)
        )
    )
    if target_tier_ids - valid_target_ids:
        raise HTTPException(status_code=400, detail="Mapping contains target tiers outside the target version")

    is_complete = _validate_mapping(source_tier_ids, data.rules)
    mapping = await get_mapping(session, source_version_id, target_version_id)
    if mapping is None:
        mapping = models.DivisionGridMapping(
            source_version_id=source_version_id,
            target_version_id=target_version_id,
            name=data.name,
            is_complete=is_complete,
        )
        session.add(mapping)
        await session.flush()
    else:
        mapping.name = data.name
        mapping.is_complete = is_complete
        await session.execute(
            sa.delete(models.DivisionGridMappingRule).where(models.DivisionGridMappingRule.mapping_id == mapping.id)
        )
        await session.flush()

    session.add_all(
        [
            models.DivisionGridMappingRule(
                mapping_id=mapping.id,
                source_tier_id=rule.source_tier_id,
                target_tier_id=rule.target_tier_id,
                weight=rule.weight,
                is_primary=rule.is_primary,
            )
            for rule in data.rules
        ]
    )
    await session.flush()
    refreshed = await get_mapping(session, source_version_id, target_version_id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Failed to persist division grid mapping")
    await division_grid_cache.invalidate_mapping(source_version_id, target_version_id)
    return refreshed
