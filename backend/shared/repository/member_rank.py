from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository

__all__ = ("MemberRankRepository",)


class MemberRankRepository(BaseRepository[models.MemberRank]):
    def __init__(self) -> None:
        super().__init__(models.MemberRank)

    async def list_layers(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        member_ids: Sequence[int],
        author_user_id: int | None = None,
        include_canon: bool = True,
    ) -> Sequence[models.MemberRank]:
        """Every layer a resolver needs, in one round trip.

        ``author_user_id`` adds that account's private rows, ``include_canon``
        keeps the workspace ones. Fetching both together is precisely why the
        table carries no ``scope`` column to filter on: the split is a cheap
        partition of rows already in memory.
        """
        if not member_ids or not (include_canon or author_user_id is not None):
            return []
        layers: list[sa.ColumnElement[bool]] = []
        if include_canon:
            layers.append(self.model.author_user_id.is_(None))
        if author_user_id is not None:
            layers.append(self.model.author_user_id == author_user_id)
        result = await session.scalars(
            self.select().where(
                self.model.workspace_id == workspace_id,
                self.model.workspace_member_id.in_(list(member_ids)),
                sa.or_(*layers),
            )
        )
        return result.all()

    async def list_layer(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        member_id: int,
        author_user_id: int | None = None,
    ) -> Sequence[models.MemberRank]:
        """Exactly one layer of one member -- the row set a write path replaces."""
        owner = (
            self.model.author_user_id.is_(None)
            if author_user_id is None
            else self.model.author_user_id == author_user_id
        )
        result = await session.scalars(
            self.select().where(
                self.model.workspace_id == workspace_id,
                self.model.workspace_member_id == member_id,
                owner,
            )
        )
        return result.all()
