"""Favorite players — the per-visitor bookmark list behind ``rpc.app.users.me_favorites_*``.

Auth-account scoped, not player scoped: a favorite is keyed by the caller's own
``auth_user_id``, so it needs no player of the caller's own to exist and survives
that player being re-linked or merged.

This lived inline in ``rpc/users_admin.py`` with its own ``session.add`` /
``session.delete`` / ``session.commit``; the transport now decodes the request and
calls one method.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.repository import FavoritePlayerRepository, UserRepository
from src import models, schemas

__all__ = ("FavoritePlayerService", "favorites")


class FavoritePlayerService:
    def __init__(
        self,
        *,
        bookmarks: FavoritePlayerRepository = FavoritePlayerRepository(),
        players: UserRepository = UserRepository(),
    ) -> None:
        self.bookmarks = bookmarks
        self.players = players

    async def list_for(self, session: AsyncSession, auth_user_id: int) -> list[schemas.LookupItem]:
        """The caller's favorites, newest bookmark first."""
        rows = await self.bookmarks.list_players(session, auth_user_id)
        return [schemas.LookupItem(id=row.id, name=row.name) for row in rows]

    async def add(self, session: AsyncSession, *, auth_user_id: int, player_id: int) -> dict:
        """Bookmark ``player_id``. Idempotent — a double-click must not trip the
        unique constraint — and 404 rather than creating an orphan row for a
        player that does not exist."""
        if not await self.players.exists(session, id=player_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

        already = await self.bookmarks.get_for_player(session, auth_user_id=auth_user_id, player_id=player_id)
        if already is None:
            await self.bookmarks.create(
                session, models.FavoritePlayer(auth_user_id=auth_user_id, player_id=player_id)
            )
            await session.commit()
        return {"ok": True}

    async def remove(self, session: AsyncSession, *, auth_user_id: int, player_id: int) -> None:
        """Drop the bookmark. Idempotent — the caller does not know or care whether
        it existed before the click."""
        row = await self.bookmarks.get_for_player(session, auth_user_id=auth_user_id, player_id=player_id)
        if row is not None:
            await self.bookmarks.delete(session, row)
            await session.commit()


favorites = FavoritePlayerService()
