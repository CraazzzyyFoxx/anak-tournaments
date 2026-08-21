from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class StatBaselineRepository(BaseRepository[models.StatBaseline]):
    def __init__(self) -> None:
        super().__init__(models.StatBaseline)

    async def replace_for_version(
        self, session: AsyncSession, formula_version: str, rows: Sequence[models.StatBaseline]
    ) -> None:
        """Atomically replace every baseline row for ``formula_version``.

        Deletes the version's existing rows then adds the freshly computed ones
        in the same flush, with no caller-mediated gap between delete and
        insert — a mid-way failure (before the caller's commit) rolls back both
        halves together instead of leaving the baseline table empty for this
        ``formula_version``, which live impact scoring reads on every call.
        """
        await session.execute(sa.delete(self.model).where(self.model.formula_version == formula_version))
        session.add_all(rows)
        await session.flush()
