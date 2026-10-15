from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import discipline as discipline_spec
from shared.division_grid import DEFAULT_GRID, DivisionGrid, ladder_grid
from shared.models.division_grid import DivisionGrid as DivisionGridModel
from shared.models.division_grid import DivisionGridMapping, DivisionGridTier, DivisionGridVersion
from shared.models.identity.auth_user import AuthUser
from shared.models.tenancy.workspace import Workspace
from shared.models.tournament import Tournament
from shared.services.division_grid import cache as division_grid_cache
from shared.services.division_grid.cache import (
    DivisionGridMappingSnapshot,
    DivisionGridVersionSnapshot,
)
from shared.services.division_grid.normalization import (
    DivisionGridNormalizationError,
    DivisionGridNormalizer,
    WeightedDivisionTarget,
)


def _system_default_version_id_expr(discipline: sa.ColumnElement[str] | None = None) -> sa.ScalarSelect[int]:
    """SQL twin of :func:`get_default_division_grid_version_id`."""
    version = aliased(DivisionGridVersion)
    grid = aliased(DivisionGridModel)
    query = sa.select(version.id).join(grid, grid.id == version.grid_id).where(grid.workspace_id.is_(None))
    if discipline is not None:
        query = query.where(grid.discipline == discipline)
    return query.order_by(version.id.asc()).limit(1).correlate_except(version, grid).scalar_subquery()


def tournament_effective_version_id_expr(tournament_id: sa.ColumnElement[int]) -> sa.ScalarSelect[int]:
    """Tournament pin → workspace default → system default, always of the owner's discipline."""
    tournament = aliased(Tournament)
    workspace = aliased(Workspace)

    def scoped_version(version_id: sa.ColumnElement[int]) -> sa.ScalarSelect[int]:
        version = aliased(DivisionGridVersion)
        grid = aliased(DivisionGridModel)
        return (
            sa.select(version.id)
            .join(grid, grid.id == version.grid_id)
            .where(
                version.id == version_id,
                grid.discipline == tournament.discipline,
                sa.or_(grid.workspace_id.is_(None), grid.workspace_id == tournament.workspace_id),
            )
            .correlate_except(version, grid)
            .scalar_subquery()
        )

    return (
        sa.select(
            sa.func.coalesce(
                scoped_version(tournament.division_grid_version_id),
                scoped_version(workspace.default_division_grid_version_id),
                _system_default_version_id_expr(tournament.discipline),
            )
        )
        .select_from(tournament)
        .outerjoin(workspace, workspace.id == tournament.workspace_id)
        .where(tournament.id == tournament_id)
        .correlate_except(tournament, workspace)
        .scalar_subquery()
    )


def effective_division_number_expr(
    rank_column: sa.ColumnElement[int],
    tournament_id_column: sa.ColumnElement[int],
) -> sa.ScalarSelect[int]:
    """SQL twin of ``DivisionGrid.resolve_division(rank).number`` on the row's own grid.

    Mirrors :func:`shared.domain.division_rank.resolve_tier_for_rank`: the tier
    whose ``[rank_min, rank_max]`` band contains the rank (unbounded top tier
    included), and the grid's floor tier for a rank below every band.

    ponytail: one correlated subquery per row — only the opt-in
    all-workspaces reads use it; the single-grid path stays on the
    index-friendly ``division_rank_bounds``/``division_case_expr``.
    """
    tier = aliased(DivisionGridTier)
    matched = sa.and_(
        tier.rank_min <= rank_column,
        sa.or_(tier.rank_max.is_(None), rank_column <= tier.rank_max),
    )
    return (
        sa.select(tier.number)
        .select_from(tier)
        .correlate_except(tier)
        .where(tier.version_id == tournament_effective_version_id_expr(tournament_id_column))
        # Containing tier first (highest floor, matching the Python iteration
        # order on overlapping bands); otherwise the grid floor tier.
        .order_by(
            sa.case((matched, 0), else_=1),
            sa.case((matched, -tier.rank_min), else_=tier.rank_min),
        )
        .limit(1)
        .scalar_subquery()
    )


def effective_division_filter_predicates(
    rank_column: sa.ColumnElement[int],
    tournament_id_column: sa.ColumnElement[int],
    div_min: int | None,
    div_max: int | None,
) -> list[sa.ColumnElement[bool]]:
    """``div_min <= division(rank) <= div_max`` resolved on each row's own grid.

    All-workspaces counterpart of
    :func:`shared.division_grid.division_filter_predicates`, which can only
    translate a division range against one grid.
    """
    if div_min is None and div_max is None:
        return []

    division = effective_division_number_expr(rank_column, tournament_id_column)
    if div_min is not None and div_max is not None:
        return [division.between(div_min, div_max)]
    if div_min is not None:
        return [division >= div_min]
    return [division <= div_max]


def require_grid_version_read_access(user: AuthUser, workspace_id: int | None) -> None:
    """System grids (workspace_id IS NULL) are readable by any authenticated user.

    Workspace-owned grids require membership so versions cannot be enumerated
    cross-workspace by id. Superuser is a workspace member of every workspace.
    """
    if workspace_id is not None and not user.is_workspace_member(workspace_id):
        raise HTTPException(status_code=403, detail="Not a member of this workspace")


def require_marketplace_source_access(
    user: AuthUser,
    *,
    source_workspace_id: int,
    source_is_hidden: bool,
) -> None:
    """Hidden source workspaces stay members/superuser-only on the marketplace."""
    if source_is_hidden and not user.is_superuser and source_workspace_id not in user.get_workspace_ids():
        raise HTTPException(status_code=403, detail="Source workspace is not accessible")


def runtime_fallback_grid(discipline: str | None) -> DivisionGrid:
    """An unscoped read keeps the legacy default; scoped reads never borrow another game's ladder."""
    grid = DEFAULT_GRID if discipline is None else ladder_grid(discipline)
    if grid is None:
        raise HTTPException(
            status_code=422,
            detail=f"division_grid_required: {discipline!r} needs a division grid of its own with tiers",
        )
    return grid


async def grid_version_discipline(session: AsyncSession, version_id: int) -> str | None:
    return await session.scalar(
        sa.select(DivisionGridModel.discipline)
        .join(DivisionGridVersion, DivisionGridVersion.grid_id == DivisionGridModel.id)
        .where(DivisionGridVersion.id == version_id)
    )


async def require_event_grid(session: AsyncSession, *, version_id: int | None, discipline: str) -> None:
    """Validate explicit pins even for games with ladders; ladder-less events need nonempty tiers."""
    if version_id is not None and await grid_version_discipline(session, version_id) != discipline:
        raise HTTPException(status_code=422, detail="division_grid_discipline_mismatch: grid and owner differ")
    if discipline_spec(discipline).native_ladder:
        return
    has_tiers = version_id is not None and await session.scalar(
        sa.select(sa.exists().where(DivisionGridTier.version_id == version_id))
    )
    if not has_tiers:
        raise HTTPException(
            status_code=422,
            detail=f"division_grid_required: a {discipline!r} event needs a division grid of its own with tiers",
        )


async def get_workspace_division_grid_version(
    session: AsyncSession,
    workspace_id: int | None,
    discipline: str | None = None,
) -> DivisionGridVersion | None:
    version_id = await get_workspace_division_grid_version_id(session, workspace_id, discipline=discipline)
    return await load_division_grid_version(session, version_id)


async def get_tournament_division_grid_version(
    session: AsyncSession,
    tournament_id: int | None,
) -> DivisionGridVersion | None:
    version_id = await get_tournament_division_grid_version_id(session, tournament_id)
    return await load_division_grid_version(session, version_id)


async def get_effective_division_grid_version(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
    *,
    discipline: str | None = None,
) -> DivisionGridVersion | None:
    version_id = await get_effective_division_grid_version_id(
        session, workspace_id, tournament_id=tournament_id, discipline=discipline
    )
    return await load_division_grid_version(session, version_id)


async def get_effective_division_grid(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
    *,
    discipline: str | None = None,
) -> DivisionGrid:
    if tournament_id is not None:
        discipline = await session.scalar(sa.select(Tournament.discipline).where(Tournament.id == tournament_id))
    snapshot = await get_effective_division_grid_snapshot(
        session, workspace_id, tournament_id=tournament_id, discipline=discipline
    )
    if snapshot is None or not snapshot.tiers:
        return runtime_fallback_grid(discipline)
    return snapshot.to_runtime_grid()


async def get_workspace_division_grid_version_id(
    session: AsyncSession,
    workspace_id: int | None,
    discipline: str | None = None,
) -> int | None:
    if workspace_id is None:
        return await get_default_division_grid_version_id(session, discipline)
    cached = await division_grid_cache.get_workspace_default_version_id(workspace_id, discipline)
    if cached is not None:
        return cached
    query = (
        sa.select(DivisionGridVersion.id)
        .join(DivisionGridModel, DivisionGridModel.id == DivisionGridVersion.grid_id)
        .join(Workspace, Workspace.default_division_grid_version_id == DivisionGridVersion.id)
        .where(
            Workspace.id == workspace_id,
            sa.or_(DivisionGridModel.workspace_id.is_(None), DivisionGridModel.workspace_id == workspace_id),
        )
    )
    if discipline is not None:
        query = query.where(DivisionGridModel.discipline == discipline)
    version_id = await session.scalar(query)
    if version_id is None:
        version_id = await get_default_division_grid_version_id(session, discipline)
    await division_grid_cache.set_workspace_default_version_id(workspace_id, version_id, discipline)
    return version_id


async def get_tournament_division_grid_version_id(
    session: AsyncSession,
    tournament_id: int | None,
) -> int | None:
    if tournament_id is None:
        return None
    return (await get_effective_division_grid_version_ids(session, [tournament_id]))[tournament_id]


async def get_effective_division_grid_version_id(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
    *,
    discipline: str | None = None,
) -> int | None:
    # A tournament is the owner: never fall back through a different caller's workspace or discipline.
    if tournament_id is not None:
        return await get_tournament_division_grid_version_id(session, tournament_id)
    return await get_workspace_division_grid_version_id(session, workspace_id, discipline=discipline)


async def get_effective_division_grid_snapshot(
    session: AsyncSession,
    workspace_id: int | None,
    tournament_id: int | None = None,
    *,
    discipline: str | None = None,
) -> DivisionGridVersionSnapshot | None:
    version_id = await get_effective_division_grid_version_id(
        session, workspace_id, tournament_id=tournament_id, discipline=discipline
    )
    return await load_division_grid_snapshot(session, version_id)


async def load_division_grid_snapshot(
    session: AsyncSession,
    version_id: int | None,
) -> DivisionGridVersionSnapshot | None:
    if version_id is None:
        return None

    cached = await division_grid_cache.get_grid_version_snapshot(version_id)
    if cached is not None:
        return cached

    version = await _load_division_grid_version_from_db(session, version_id)
    if version is None:
        return None

    snapshot = DivisionGridVersionSnapshot.from_model(version)
    await division_grid_cache.set_grid_version_snapshot(snapshot)
    return snapshot


async def get_effective_division_grid_version_ids(
    session: AsyncSession,
    tournament_ids: Iterable[int],
) -> dict[int, int | None]:
    """Batch equivalent of calling ``get_effective_division_grid_version_id`` once per id.

    Built for read models that need many tournaments' effective grid version at
    once (e.g. a player's cross-tournament history): a naive per-id loop pays
    one Redis round trip and up to two DB round trips PER tournament -- fine
    for a handful of ids, but dozens of sequential awaits for a player with a
    long history, all serialized behind the one ``AsyncSession`` they share (a
    single asyncpg connection cannot run concurrent queries, so this cannot be
    fixed with ``asyncio.gather`` over the per-id calls instead). This
    resolves the whole set in a constant number of round trips: one Redis MGET
    for the effective-version cache, at most one DB query for the tournaments
    that missed, and one more round trip per distinct owning workspace whose
    default is still needed. Every resolved value is written back to cache
    exactly like the single-item path, so a later single lookup (or the next
    batch) still gets full cache benefit.

    The fallback default is each tournament's *own* workspace default, so a
    set spanning workspaces (the public all-workspaces reads) resolves exactly
    like the per-id function would -- the effective version is a property of
    the tournament alone, never of the reader's scope.
    """
    ids = list(dict.fromkeys(tournament_ids))
    if not ids:
        return {}

    resolved = await division_grid_cache.get_tournament_effective_version_ids(ids)
    missing = [tournament_id for tournament_id in ids if tournament_id not in resolved]
    if not missing:
        return resolved

    rows = (
        await session.execute(
            sa.select(
                Tournament.id,
                Tournament.division_grid_version_id,
                Tournament.workspace_id,
                Tournament.discipline,
                DivisionGridModel.discipline,
                DivisionGridModel.workspace_id,
            )
            .outerjoin(DivisionGridVersion, DivisionGridVersion.id == Tournament.division_grid_version_id)
            .outerjoin(DivisionGridModel, DivisionGridModel.id == DivisionGridVersion.grid_id)
            .where(Tournament.id.in_(missing))
        )
    ).all()
    row_by_tournament = {int(row[0]): row for row in rows}

    defaults: dict[tuple[int, str], int | None] = {}
    to_cache: dict[int, int | None] = {}
    for tournament_id in missing:
        row = row_by_tournament.get(tournament_id)
        if row is None:
            version_id = None
        elif row[1] is not None:
            if row[4] != row[3] or row[5] not in (None, row[2]):
                raise HTTPException(status_code=422, detail="division_grid_discipline_mismatch: invalid tournament pin")
            version_id = int(row[1])
        else:
            scope = (int(row[2]), row[3])
            if scope not in defaults:
                defaults[scope] = await get_workspace_division_grid_version_id(session, scope[0], discipline=scope[1])
            version_id = defaults[scope]
        resolved[tournament_id] = version_id
        to_cache[tournament_id] = version_id
    await division_grid_cache.set_tournament_effective_version_ids(to_cache)
    return resolved


async def load_division_grid_snapshots(
    session: AsyncSession,
    version_ids: Iterable[int],
) -> dict[int, DivisionGridVersionSnapshot]:
    """Batch equivalent of calling ``load_division_grid_snapshot`` once per id.

    Same shape as ``get_effective_division_grid_version_ids``: one Redis MGET
    for the already-cached snapshots, at most one DB query (with
    ``selectinload(tiers)``) for the ones that missed, one cache write-back.
    A version id absent from the result was not found in the database either
    (deleted grid version) -- callers fall back the same way the single-item
    path does (``load_runtime_grid(None)``).
    """
    ids = {int(version_id) for version_id in version_ids}
    if not ids:
        return {}

    snapshot_by_version = await division_grid_cache.get_grid_version_snapshots(list(ids))
    missing = ids - snapshot_by_version.keys()
    if missing:
        versions = (
            await session.scalars(
                sa.select(DivisionGridVersion)
                .options(selectinload(DivisionGridVersion.tiers))
                .where(DivisionGridVersion.id.in_(missing))
            )
        ).all()
        fresh = {int(version.id): DivisionGridVersionSnapshot.from_model(version) for version in versions}
        snapshot_by_version.update(fresh)
        await division_grid_cache.set_grid_version_snapshots(fresh)

    return snapshot_by_version


async def load_division_grids(
    session: AsyncSession,
    version_ids: Iterable[int],
) -> dict[int, DivisionGrid]:
    """Runtime grids for many versions at once (cached, one query for the misses).

    A version id missing from the result was not found in the database; callers
    fall back to their request-level grid.
    """
    snapshots = await load_division_grid_snapshots(session, version_ids)
    return {version_id: snapshot.to_runtime_grid() for version_id, snapshot in snapshots.items()}


def _division_grid_version_read_payload(version: DivisionGridVersion) -> dict[str, Any]:
    """JSON-shaped payload matching every service's own ``DivisionGridVersionRead``.

    Each service defines an identical copy of that pydantic schema; this
    module cannot import any of them (services depend on ``shared``, never the
    reverse), so it hands back a plain, ``Read.model_validate``-ready dict
    instead.
    """
    return {
        "id": int(version.id),
        "grid_id": int(version.grid_id),
        "version": int(version.version),
        "label": version.label,
        "status": version.status,
        "created_from_version_id": (
            int(version.created_from_version_id) if version.created_from_version_id is not None else None
        ),
        "published_at": version.published_at.isoformat() if version.published_at is not None else None,
        "tiers": [
            {
                "id": tier.id,
                "version_id": int(version.id),
                "slug": tier.slug,
                "number": int(tier.number),
                "name": tier.name,
                "sort_order": int(tier.sort_order),
                "rank_min": int(tier.rank_min),
                "rank_max": int(tier.rank_max) if tier.rank_max is not None else None,
                "icon_url": tier.icon_url,
            }
            for tier in version.tiers
        ],
    }


async def load_division_grid_version_read_payloads(
    session: AsyncSession,
    version_ids: Iterable[int],
) -> dict[int, dict[str, Any]]:
    """Batch, cached full read-model payloads for grid versions.

    Built for read models that render grid-version metadata for many ids at
    once (e.g. every distinct version referenced in a player's tournament
    history): one Redis MGET for the cache, at most one DB query
    (``WHERE id IN (...)``) for the versions that missed -- replacing what
    was previously an unconditional query on every call regardless of cache
    state. Each caller builds its own ``DivisionGridVersionRead`` via
    ``Read.model_validate(payload)`` -- no per-field mapping, and no risk of
    drifting from the schema as it evolves, since the payload shape mirrors
    it 1:1.
    """
    ids = {int(version_id) for version_id in version_ids}
    if not ids:
        return {}

    payloads = await division_grid_cache.get_grid_version_read_payloads(list(ids))
    missing = ids - payloads.keys()
    if missing:
        versions = (
            await session.scalars(
                sa.select(DivisionGridVersion)
                .options(selectinload(DivisionGridVersion.tiers))
                .where(DivisionGridVersion.id.in_(missing))
            )
        ).all()
        fresh = {int(version.id): _division_grid_version_read_payload(version) for version in versions}
        payloads.update(fresh)
        await division_grid_cache.set_grid_version_read_payloads(fresh)

    return payloads


async def _load_division_grid_version_from_db(
    session: AsyncSession,
    version_id: int,
) -> DivisionGridVersion | None:
    return await session.scalar(
        sa.select(DivisionGridVersion)
        .options(selectinload(DivisionGridVersion.tiers))
        .where(DivisionGridVersion.id == version_id)
    )


async def load_division_grid_version(
    session: AsyncSession,
    version_id: int | None,
) -> DivisionGridVersion | None:
    if version_id is None:
        return None

    return await _load_division_grid_version_from_db(session, version_id)


async def get_default_division_grid_version(
    session: AsyncSession, discipline: str | None = None
) -> DivisionGridVersion | None:
    version_id = await get_default_division_grid_version_id(session, discipline)
    return await load_division_grid_version(session, version_id)


async def get_default_division_grid_version_id(session: AsyncSession, discipline: str | None = None) -> int | None:
    query = (
        sa.select(DivisionGridVersion.id)
        .join(DivisionGridModel, DivisionGridModel.id == DivisionGridVersion.grid_id)
        .where(DivisionGridModel.workspace_id.is_(None))
    )
    if discipline is not None:
        query = query.where(DivisionGridModel.discipline == discipline)
    return await session.scalar(query.order_by(DivisionGridVersion.id.asc()).limit(1))


async def load_mapping_snapshot(
    session: AsyncSession,
    source_version_id: int,
    target_version_id: int,
) -> DivisionGridMappingSnapshot | None:
    cached = await division_grid_cache.get_mapping_snapshot(source_version_id, target_version_id)
    if cached is not None:
        return cached

    mapping = await session.scalar(
        sa.select(DivisionGridMapping)
        .options(selectinload(DivisionGridMapping.rules))
        .where(
            DivisionGridMapping.source_version_id == source_version_id,
            DivisionGridMapping.target_version_id == target_version_id,
        )
    )
    if mapping is None:
        return None

    snapshot = DivisionGridMappingSnapshot.from_model(mapping)
    await division_grid_cache.set_mapping_snapshot(snapshot)
    return snapshot


async def get_workspace_source_version_ids(
    session: AsyncSession,
    workspace_id: int,
    discipline: str | None = None,
) -> set[int]:
    cached = await division_grid_cache.get_workspace_source_version_ids(workspace_id, discipline)
    if cached is not None:
        return cached
    query = sa.select(Tournament.division_grid_version_id.distinct()).where(
        Tournament.workspace_id == workspace_id,
        Tournament.division_grid_version_id.is_not(None),
    )
    if discipline is not None:
        query = query.where(Tournament.discipline == discipline)
    result = await session.execute(query)
    version_ids = {int(version_id) for version_id in result.scalars().all() if version_id is not None}
    await division_grid_cache.set_workspace_source_version_ids(workspace_id, version_ids, discipline)
    return version_ids


async def build_workspace_division_grid_normalizer(
    session: AsyncSession,
    workspace_id: int,
    *,
    target_version_id: int | None = None,
    source_version_ids: Iterable[int] | None = None,
    require_complete: bool = True,
    discipline: str | None = None,
) -> DivisionGridNormalizer:
    resolved_target_version_id = target_version_id or await get_workspace_division_grid_version_id(
        session,
        workspace_id,
        discipline=discipline,
    )
    if resolved_target_version_id is None:
        raise DivisionGridNormalizationError(f"Workspace {workspace_id} does not have a default division grid version")
    target_discipline = await grid_version_discipline(session, resolved_target_version_id)
    if discipline is not None and target_discipline != discipline:
        raise DivisionGridNormalizationError("Target grid belongs to another discipline")

    target_snapshot = await load_division_grid_snapshot(session, resolved_target_version_id)
    if target_snapshot is None:
        raise DivisionGridNormalizationError(f"Target division grid version {resolved_target_version_id} was not found")

    target_grid = target_snapshot.to_runtime_grid()
    target_tiers_by_id = {tier.id: tier for tier in target_grid.tiers if tier.id is not None}

    resolved_source_version_ids = set(source_version_ids or [])
    if not resolved_source_version_ids:
        resolved_source_version_ids = await get_workspace_source_version_ids(session, workspace_id, target_discipline)
    resolved_source_version_ids.add(resolved_target_version_id)

    source_grids_by_version_id: dict[int, DivisionGrid] = {}
    for source_version_id in resolved_source_version_ids:
        if await grid_version_discipline(session, source_version_id) != target_discipline:
            raise DivisionGridNormalizationError("Cannot normalize division grids of different disciplines")
        snapshot = await load_division_grid_snapshot(session, source_version_id)
        if snapshot is None:
            raise DivisionGridNormalizationError(f"Division grid versions are missing: {[source_version_id]}")
        source_grids_by_version_id[source_version_id] = snapshot.to_runtime_grid()

    foreign_source_version_ids = [
        version_id for version_id in resolved_source_version_ids if version_id != resolved_target_version_id
    ]

    primary_target_by_source_tier_id = {}
    weighted_targets_by_source_tier_id = {}

    for source_version_id in foreign_source_version_ids:
        mapping = await load_mapping_snapshot(
            session,
            source_version_id,
            resolved_target_version_id,
        )
        if mapping is None:
            if require_complete:
                raise DivisionGridNormalizationError(
                    "Missing division grid mappings to normalized base version "
                    f"{resolved_target_version_id}: {[source_version_id]}"
                )
            continue

        if require_complete and not mapping.is_complete:
            raise DivisionGridNormalizationError(
                f"Division grid mapping {mapping.id} from version {source_version_id} "
                f"to {resolved_target_version_id} is incomplete"
            )

        rules_by_source_tier_id: dict[int, list[WeightedDivisionTarget]] = {}
        primary_rule_target_by_source_tier_id = {}

        for rule in mapping.rules:
            target_tier = target_tiers_by_id.get(rule.target_tier_id)
            if target_tier is None:
                raise DivisionGridNormalizationError(
                    f"Target tier {rule.target_tier_id} is outside normalized version {resolved_target_version_id}"
                )
            rules_by_source_tier_id.setdefault(rule.source_tier_id, []).append(
                WeightedDivisionTarget(tier=target_tier, weight=float(rule.weight))
            )
            if rule.is_primary:
                primary_rule_target_by_source_tier_id[rule.source_tier_id] = target_tier

        source_grid = source_grids_by_version_id[source_version_id]
        for source_tier in source_grid.tiers:
            if source_tier.id is None:
                raise DivisionGridNormalizationError(f"Source tier id is missing for version {source_version_id}")
            weighted_targets = tuple(rules_by_source_tier_id.get(source_tier.id, []))
            if require_complete and not weighted_targets:
                raise DivisionGridNormalizationError(
                    f"Source tier {source_tier.id} in version {source_version_id} "
                    f"is not covered by mapping to {resolved_target_version_id}"
                )
            if not weighted_targets:
                continue

            weighted_targets_by_source_tier_id[source_tier.id] = weighted_targets
            if len(weighted_targets) == 1:
                primary_target_by_source_tier_id[source_tier.id] = weighted_targets[0].tier
                continue

            primary_target = primary_rule_target_by_source_tier_id.get(source_tier.id)
            if primary_target is None and require_complete:
                raise DivisionGridNormalizationError(
                    f"Primary mapping is missing for split source tier {source_tier.id}"
                )
            if primary_target is not None:
                primary_target_by_source_tier_id[source_tier.id] = primary_target

    return DivisionGridNormalizer(
        target_version_id=resolved_target_version_id,
        target_grid=target_grid,
        source_grids_by_version_id=source_grids_by_version_id,
        primary_target_by_source_tier_id=primary_target_by_source_tier_id,
        weighted_targets_by_source_tier_id=weighted_targets_by_source_tier_id,
    )
