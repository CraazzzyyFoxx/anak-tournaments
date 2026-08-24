from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import HostPlayerRankRepository, HostPlayerRepository, WorkspacePlayerRepository

__all__ = ("HostBookService", "host_book_service")


def _require_host(actor_user_id: int, host_user_id: int) -> None:
    if actor_user_id != host_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the host can write this pool")


class HostBookService:
    def __init__(
        self,
        *,
        players: WorkspacePlayerRepository = WorkspacePlayerRepository(),
        memberships: HostPlayerRepository = HostPlayerRepository(),
        book: HostPlayerRankRepository = HostPlayerRankRepository(),
    ) -> None:
        self.players = players
        self.memberships = memberships
        self.book = book

    async def _player_in_workspace(
        self, session: AsyncSession, workspace_id: int, workspace_player_id: int
    ) -> models.WorkspacePlayer:
        player = await self.players.get(session, workspace_player_id)
        if player is None or player.workspace_id != workspace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        return player

    async def add(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        host_user_id: int,
        workspace_player_id: int,
        actor_user_id: int,
    ) -> models.HostPlayer:
        _require_host(actor_user_id, host_user_id)
        await self._player_in_workspace(session, workspace_id, workspace_player_id)
        existing = await self.memberships.get_by(
            session,
            workspace_id=workspace_id,
            host_user_id=host_user_id,
            workspace_player_id=workspace_player_id,
        )
        if existing is not None:
            return existing
        row = models.HostPlayer(
            workspace_id=workspace_id,
            host_user_id=host_user_id,
            workspace_player_id=workspace_player_id,
        )
        try:
            async with session.begin_nested():
                return await self.memberships.create(session, row)
        except IntegrityError:
            raced = await self.memberships.get_by(
                session,
                workspace_id=workspace_id,
                host_user_id=host_user_id,
                workspace_player_id=workspace_player_id,
            )
            if raced is None:
                raise
            return raced

    async def remove(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        host_user_id: int,
        workspace_player_id: int,
        actor_user_id: int,
    ) -> None:
        _require_host(actor_user_id, host_user_id)
        row = await self.memberships.get_by(
            session,
            workspace_id=workspace_id,
            host_user_id=host_user_id,
            workspace_player_id=workspace_player_id,
        )
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Host player not found")
        await self.memberships.delete(session, row)

    async def set_ranks(
        self,
        session: AsyncSession,
        *,
        host_user_id: int,
        workspace_player_id: int,
        ranks: Mapping[str, int],
        actor_user_id: int,
    ) -> dict[str, int]:
        _require_host(actor_user_id, host_user_id)
        player = await self.players.get(session, workspace_player_id)
        if player is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
        existing = {row.role: row for row in await self.book.list_book(session, host_user_id, workspace_player_id)}
        for role, value in ranks.items():
            row = existing.get(role)
            if row is None:
                created = models.HostPlayerRank(
                    host_user_id=host_user_id,
                    workspace_player_id=workspace_player_id,
                    role=role,
                    rank_value=value,
                )
                try:
                    async with session.begin_nested():
                        await self.book.create(session, created)
                    existing[role] = created
                except IntegrityError:
                    raced = {r.role: r for r in await self.book.list_book(session, host_user_id, workspace_player_id)}
                    row = raced.get(role)
                    if row is None:
                        raise
                    existing[role] = row
                    row.rank_value = value
            else:
                row.rank_value = value
        await session.flush()
        return {role: row.rank_value for role, row in existing.items()}

    async def list_pool(
        self, session: AsyncSession, *, workspace_id: int, host_user_id: int
    ) -> list[models.HostPlayer]:
        return list(await self.memberships.list_pool(session, workspace_id, host_user_id))

    async def get_book(
        self, session: AsyncSession, *, host_user_id: int, workspace_player_id: int
    ) -> dict[str, int]:
        rows = await self.book.list_book(session, host_user_id, workspace_player_id)
        return {row.role: row.rank_value for row in rows}


host_book_service = HostBookService()
