from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.domain.workspace_player import merge_ranks, normalize_battle_tag, normalize_battle_tag_key
from shared.repository import WorkspacePlayerRankRepository, WorkspacePlayerRepository

__all__ = ("WorkspacePlayerService", "workspace_player_service")


class WorkspacePlayerService:
    def __init__(
        self,
        *,
        players: WorkspacePlayerRepository = WorkspacePlayerRepository(),
        ranks: WorkspacePlayerRankRepository = WorkspacePlayerRankRepository(),
    ) -> None:
        self.players = players
        self.ranks = ranks

    async def upsert(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        battle_tag: str,
        display_name: str | None = None,
    ) -> models.WorkspacePlayer:
        normalized = normalize_battle_tag(battle_tag)
        key = normalize_battle_tag_key(battle_tag)
        if normalized is None or key is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="battle_tag is required")
        existing = await self.players.get_active_by_tag(session, workspace_id, key)
        if existing is not None:
            existing.battle_tag = normalized
            if display_name is not None:
                existing.display_name = display_name
            await session.flush()
            return existing
        row = models.WorkspacePlayer(
            workspace_id=workspace_id,
            battle_tag=normalized,
            battle_tag_normalized=key,
            display_name=display_name,
        )
        try:
            async with session.begin_nested():
                return await self.players.create(session, row)
        except IntegrityError:
            raced = await self.players.get_active_by_tag(session, workspace_id, key)
            if raced is None:
                raise
            return raced

    async def link(
        self,
        session: AsyncSession,
        *,
        workspace_player_id: int,
        player_id: int,
        workspace_member_id: int | None = None,
    ) -> models.WorkspacePlayer:
        row = await self.players.get(session, workspace_player_id)
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        taken = await self.players.get_active_by_player_id(session, row.workspace_id, player_id)
        if taken is not None and taken.id != row.id:
            return await self.merge(session, survivor_id=taken.id, donor_id=row.id)
        row.player_id = player_id
        if workspace_member_id is not None:
            row.workspace_member_id = workspace_member_id
        await session.flush()
        return row

    async def merge(self, session: AsyncSession, *, survivor_id: int, donor_id: int) -> models.WorkspacePlayer:
        survivor = await self.players.get(session, survivor_id)
        donor = await self.players.get(session, donor_id)
        if survivor is None or donor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        if survivor.workspace_id != donor.workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot merge workspace players from different workspaces",
            )
        if survivor.id == donor.id:
            return survivor
        survivor_ranks = await self.ranks.list_ranks(session, survivor.id)
        donor_ranks = await self.ranks.list_ranks(session, donor.id)
        plan = merge_ranks(survivor_ranks, donor_ranks)
        by_id = {rank.id: rank for rank in (*survivor_ranks, *donor_ranks) if rank.id is not None}
        for rank_id in plan.delete_ids:
            await self.ranks.delete(session, by_id[rank_id])
        for moved in plan.move:
            if moved.id is None:
                continue
            by_id[moved.id].workspace_player_id = survivor.id
        if plan.move:
            await session.flush()
        await self.players.delete(session, donor)
        return survivor


workspace_player_service = WorkspacePlayerService()
