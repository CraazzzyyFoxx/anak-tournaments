"""Admin service for the per-tournament preview allowlist (issue #115).

Idempotent add, hard delete, ordered list. Callers gate on
``is_workspace_admin`` before invoking these.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.tournament.preview_access import TournamentPreviewAccess
from shared.repository import TournamentPreviewAccessRepository


class PreviewAccessService:
    def __init__(
        self,
        *,
        preview_access_repo: TournamentPreviewAccessRepository = TournamentPreviewAccessRepository(),
    ) -> None:
        self.preview_access_repo = preview_access_repo

    async def list_preview_access(self, session: AsyncSession, tournament_id: int) -> list[TournamentPreviewAccess]:
        return list(await self.preview_access_repo.list_for_tournament(session, tournament_id))

    async def add_preview_access(
        self, session: AsyncSession, tournament_id: int, auth_user_id: int
    ) -> TournamentPreviewAccess:
        existing = await self.preview_access_repo.get_grant(
            session, tournament_id=tournament_id, auth_user_id=auth_user_id
        )
        if existing is not None:
            return existing
        row = await self.preview_access_repo.create(
            session, TournamentPreviewAccess(tournament_id=tournament_id, auth_user_id=auth_user_id)
        )
        await session.commit()
        await session.refresh(row)
        return row

    async def remove_preview_access(self, session: AsyncSession, tournament_id: int, auth_user_id: int) -> None:
        await self.preview_access_repo.revoke(session, tournament_id=tournament_id, auth_user_id=auth_user_id)
        await session.commit()


def serialize_entry(row: TournamentPreviewAccess) -> dict:
    return {
        "id": row.id,
        "tournament_id": row.tournament_id,
        "auth_user_id": row.auth_user_id,
        "created_at": row.created_at.isoformat() if row.created_at is not None else None,
    }


preview_access_service = PreviewAccessService()
