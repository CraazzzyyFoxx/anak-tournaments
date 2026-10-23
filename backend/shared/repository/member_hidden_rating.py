from __future__ import annotations

from collections.abc import Mapping, Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository

__all__ = ("MemberHiddenRatingRepository",)

#: ``(workspace_member_id, role_id) -> (mu, sigma)``
HiddenMap = Mapping[tuple[int, int], tuple[float, float]]


class MemberHiddenRatingRepository(BaseRepository[models.MemberHiddenRating]):
    def __init__(self) -> None:
        super().__init__(models.MemberHiddenRating)

    async def for_members(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        member_ids: Sequence[int],
        for_update: bool = False,
    ) -> dict[tuple[int, int], tuple[float, float]]:
        """Every stored role of these members, in one read.

        ``for_update`` locks the rows a recording is about to overwrite, so two
        lobbies recording at once cannot both rate from the same stale value.
        """
        if not member_ids:
            return {}
        stmt = sa.select(self.model.workspace_member_id, self.model.role_id, self.model.mu, self.model.sigma).where(
            self.model.workspace_id == workspace_id,
            self.model.workspace_member_id.in_(list(member_ids)),
        )
        if for_update:
            stmt = stmt.with_for_update()
        rows = await session.execute(stmt)
        return {(member_id, role_id): (mu, sigma) for member_id, role_id, mu, sigma in rows.all()}

    async def upsert_many(self, session: AsyncSession, *, workspace_id: int, ratings: HiddenMap) -> None:
        if not ratings:
            return
        role = models.CatalogRole
        dimension_of = dict(
            (
                await session.execute(
                    sa.select(role.id, role.dimension_id).where(role.id.in_(sorted({rid for _m, rid in ratings})))
                )
            ).all()
        )
        rows = [
            {
                "workspace_id": workspace_id,
                "workspace_member_id": member_id,
                "dimension_id": dimension_of[role_id],
                "role_id": role_id,
                "mu": mu,
                "sigma": sigma,
            }
            for (member_id, role_id), (mu, sigma) in ratings.items()
        ]
        # Chunked: asyncpg caps one statement at 32767 bind parameters.
        for start in range(0, len(rows), 1000):
            stmt = insert(self.model).values(rows[start : start + 1000])
            await session.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_member_hidden_rating_member_role_id",
                    set_={"mu": stmt.excluded.mu, "sigma": stmt.excluded.sigma, "updated_at": sa.func.now()},
                )
            )

    async def replace_for_workspace(self, session: AsyncSession, *, workspace_id: int, ratings: HiddenMap) -> None:
        """Swap the workspace's whole hidden book for a freshly rebuilt one."""
        await session.execute(sa.delete(self.model).where(self.model.workspace_id == workspace_id))
        await self.upsert_many(session, workspace_id=workspace_id, ratings=ratings)

    async def count_for_workspace(self, session: AsyncSession, workspace_id: int) -> int:
        return int(
            await session.scalar(
                sa.select(sa.func.count()).select_from(self.model).where(self.model.workspace_id == workspace_id)
            )
            or 0
        )
