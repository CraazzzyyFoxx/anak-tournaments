"""A stored rank's division as a reader sees it. No rank (NULL, e.g. a 1v1 duel) has no division: every resolver
returns ``None`` for it."""

from __future__ import annotations

from shared.division_grid import DEFAULT_GRID, DivisionGrid, DivisionTier
from shared.services.division_grid.normalization import (
    DivisionGridNormalizationError,
    DivisionGridNormalizer,
)


def resolve_tournament_tier(
    rank: int | None,
    *,
    tournament_grid: DivisionGrid | None = None,
    fallback_grid: DivisionGrid | None = None,
) -> DivisionTier | None:
    grid = tournament_grid or fallback_grid or DEFAULT_GRID
    return grid.resolve_division(rank)


def resolve_tournament_division(
    rank: int | None,
    *,
    tournament_grid: DivisionGrid | None = None,
    fallback_grid: DivisionGrid | None = None,
) -> int | None:
    tier = resolve_tournament_tier(
        rank,
        tournament_grid=tournament_grid,
        fallback_grid=fallback_grid,
    )
    return None if tier is None else tier.number


def resolve_workspace_tier(
    rank: int | None,
    *,
    source_version_id: int | None,
    fallback_grid: DivisionGrid,
    normalizer: DivisionGridNormalizer | None = None,
    source_grid: DivisionGrid | None = None,
) -> DivisionTier | None:
    """Tier for ``rank`` as the reader should see it.

    With a ``normalizer`` (workspace-scoped read) every rank is mapped onto the
    workspace's target grid. Without one, ``source_grid`` -- the grid the rank
    was actually played on -- wins when the caller could resolve it (the
    all-workspaces read, where there is no single target grid to normalize to),
    and ``fallback_grid`` is the last resort.
    """
    if normalizer is not None and source_version_id is not None:
        try:
            return normalizer.normalize_division(source_version_id, rank)
        except DivisionGridNormalizationError:
            normalizer_source_grid = normalizer.source_grids_by_version_id.get(source_version_id)
            return (normalizer_source_grid or fallback_grid).resolve_division(rank)

    if normalizer is not None:
        return normalizer.target_grid.resolve_division(rank)

    return (source_grid or fallback_grid).resolve_division(rank)


def resolve_workspace_division(
    rank: int | None,
    *,
    source_version_id: int | None,
    fallback_grid: DivisionGrid,
    normalizer: DivisionGridNormalizer | None = None,
    source_grid: DivisionGrid | None = None,
) -> int | None:
    tier = resolve_workspace_tier(
        rank,
        source_version_id=source_version_id,
        fallback_grid=fallback_grid,
        normalizer=normalizer,
        source_grid=source_grid,
    )
    return None if tier is None else tier.number
