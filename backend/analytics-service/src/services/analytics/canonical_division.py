"""Source-grid snapshot loading for canonical division normalization.

The canonical numerical mapping itself belongs to the discipline's analytics module (reached through
``src.core.analytics_exports``); this module owns only the session-taking snapshot loader.
"""

from __future__ import annotations

import typing

from sqlalchemy.ext.asyncio import AsyncSession

from shared.division_grid import DivisionGrid
from shared.services.division_grid.access import load_division_grid_snapshots

__all__ = ("load_source_grids",)


async def load_source_grids(
    session: AsyncSession,
    version_ids: typing.Iterable[int],
) -> dict[int, DivisionGrid]:
    """Load runtime grids keyed by version id (cached via grid snapshots).

    Missing versions are omitted; callers fall back to ``DEFAULT_GRID`` for
    those (and for ``None`` version ids) via the module's ``canonical_div_for``.

    Batched: one Redis round trip (plus at most one DB query for whatever
    misses it) for the WHOLE set instead of one round trip per version id --
    callers here pass every distinct grid version across a tournament's, or
    the platform's full, history, which routinely spans dozens of ids.
    """
    ids = {int(v) for v in version_ids}
    snapshots = await load_division_grid_snapshots(session, ids)
    return {version_id: snapshot.to_runtime_grid() for version_id, snapshot in snapshots.items()}
