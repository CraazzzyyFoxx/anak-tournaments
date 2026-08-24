from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository


class WorkspacePlayerRepository(BaseRepository[models.WorkspacePlayer]):
    def __init__(self) -> None:
        super().__init__(models.WorkspacePlayer)

    async def get_active_by_tag(
        self,
        session: AsyncSession,
        workspace_id: int,
        battle_tag_normalized: str,
    ) -> models.WorkspacePlayer | None:
        return await self.get_by(
            session,
            workspace_id=workspace_id,
            battle_tag_normalized=battle_tag_normalized,
            hidden_at=None,
        )

    async def get_active_by_player_id(
        self,
        session: AsyncSession,
        workspace_id: int,
        player_id: int,
    ) -> models.WorkspacePlayer | None:
        return await self.get_by(
            session,
            workspace_id=workspace_id,
            player_id=player_id,
            hidden_at=None,
        )


class WorkspacePlayerRankRepository(BaseRepository[models.WorkspacePlayerRank]):
    def __init__(self) -> None:
        super().__init__(models.WorkspacePlayerRank)

    async def list_ranks(self, session: AsyncSession, workspace_player_id: int) -> Sequence[models.WorkspacePlayerRank]:
        result = await session.scalars(self.select().where(self.model.workspace_player_id == workspace_player_id))
        return result.all()

    async def list_ranks_for_players(
        self, session: AsyncSession, workspace_player_ids: Sequence[int]
    ) -> Sequence[models.WorkspacePlayerRank]:
        if not workspace_player_ids:
            return []
        result = await session.scalars(
            self.select().where(self.model.workspace_player_id.in_(workspace_player_ids))
        )
        return result.all()


class HostPlayerRepository(BaseRepository[models.HostPlayer]):
    def __init__(self) -> None:
        super().__init__(models.HostPlayer)

    async def list_for_player(self, session: AsyncSession, workspace_player_id: int) -> Sequence[models.HostPlayer]:
        result = await session.scalars(self.select().where(self.model.workspace_player_id == workspace_player_id))
        return result.all()

    async def list_pool(
        self, session: AsyncSession, workspace_id: int, host_user_id: int
    ) -> Sequence[models.HostPlayer]:
        result = await session.scalars(
            self.select().where(
                self.model.workspace_id == workspace_id,
                self.model.host_user_id == host_user_id,
            )
        )
        return result.all()


class HostPlayerRankRepository(BaseRepository[models.HostPlayerRank]):
    def __init__(self) -> None:
        super().__init__(models.HostPlayerRank)

    async def list_for_player(
        self, session: AsyncSession, workspace_player_id: int
    ) -> Sequence[models.HostPlayerRank]:
        result = await session.scalars(self.select().where(self.model.workspace_player_id == workspace_player_id))
        return result.all()

    async def list_book(
        self, session: AsyncSession, host_user_id: int, workspace_player_id: int
    ) -> Sequence[models.HostPlayerRank]:
        result = await session.scalars(
            self.select().where(
                self.model.host_user_id == host_user_id,
                self.model.workspace_player_id == workspace_player_id,
            )
        )
        return result.all()

    async def list_for_host_players(
        self, session: AsyncSession, host_user_id: int, workspace_player_ids: Sequence[int]
    ) -> Sequence[models.HostPlayerRank]:
        if not workspace_player_ids:
            return []
        result = await session.scalars(
            self.select().where(
                self.model.host_user_id == host_user_id,
                self.model.workspace_player_id.in_(workspace_player_ids),
            )
        )
        return result.all()
