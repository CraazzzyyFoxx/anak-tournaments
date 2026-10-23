from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class WorkspaceEventRepository(BaseRepository[models.WorkspaceEvent]):
    def __init__(self) -> None:
        super().__init__(models.WorkspaceEvent)

    async def last_id_for_topics(self, session: AsyncSession, topics: Sequence[str]) -> int | None:
        """Newest persisted event id across ``topics``; ``None`` when none has any."""
        return await session.scalar(sa.select(sa.func.max(self.model.id)).where(self.model.topic.in_(topics)))
