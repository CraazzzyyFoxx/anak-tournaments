from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class StatBaselineRepository(BaseRepository[models.StatsBaseline]):
    def __init__(self) -> None:
        super().__init__(models.StatsBaseline)

    async def replace_for_version(
        self,
        session: AsyncSession,
        formula_version: str,
        rows: Sequence[models.StatsBaseline],
        *,
        discipline: str,
    ) -> None:
        """Atomically replace the discipline's rated-role baselines for a version.

        Deletes the version's existing rows then adds the freshly computed ones
        in the same flush, with no caller-mediated gap between delete and
        insert — a mid-way failure (before the caller's commit) rolls back both
        halves together instead of leaving the baseline table empty for this
        ``formula_version``, which live impact scoring reads on every call.
        """
        role, dimension, stat = models.CatalogRole, models.RoleDimension, models.StatDef
        role_ids = (
            sa.select(role.id)
            .join(dimension, dimension.id == role.dimension_id)
            .where(
                dimension.discipline == discipline,
                dimension.rated.is_(True),
            )
        )
        stat_ids = sa.select(stat.id).where(stat.discipline == discipline)
        with session.no_autoflush:
            allowed_roles = set(await session.scalars(role_ids))
            allowed_stats = set(await session.scalars(stat_ids))
            if any(
                row.formula_version != formula_version
                or row.role_id not in allowed_roles
                or row.stat_id not in allowed_stats
                for row in rows
            ):
                raise ValueError("baseline rows must belong to the named discipline, rated dimension and version")
        await session.execute(
            sa.delete(self.model).where(
                self.model.formula_version == formula_version,
                self.model.role_id.in_(role_ids),
                self.model.stat_id.in_(stat_ids),
            )
        )
        session.add_all(rows)
        await session.flush()
