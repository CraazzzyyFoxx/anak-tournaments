"""Encounter-satellite CRUD: games, audits, room journal, saved views, links.

The ``Encounter`` row itself lives in :mod:`shared.repository.tournament`
(``EncounterRepository``); this module owns the tables that hang off it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.strategy_options import _AbstractLoad

from shared import models
from shared.core import enums
from shared.repository.base import BaseRepository


class EncounterGameRepository(BaseRepository[models.EncounterGame]):
    def __init__(self) -> None:
        super().__init__(models.EncounterGame)

    async def list_for_encounter(
        self, session: AsyncSession, encounter_id: int, *, include_cancelled: bool = False
    ) -> Sequence[models.EncounterGame]:
        query = self.select().where(models.EncounterGame.encounter_id == encounter_id)
        if not include_cancelled:
            query = query.where(models.EncounterGame.state != enums.EncounterGameState.CANCELLED)
        result = await session.execute(query.order_by(models.EncounterGame.position, models.EncounterGame.id))
        return result.scalars().all()

    async def get_for_update(self, session: AsyncSession, game_id: int) -> models.EncounterGame | None:
        result = await session.execute(
            self.select()
            .where(models.EncounterGame.id == game_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalars().first()


class EncounterResultAuditRepository(BaseRepository[models.EncounterResultAudit]):
    def __init__(self) -> None:
        super().__init__(models.EncounterResultAudit)

    def add(self, session: AsyncSession, row: models.EncounterResultAudit) -> models.EncounterResultAudit:
        """Stage one journal row. No flush — rides the caller's transaction."""
        session.add(row)
        return row

    async def list_for_encounter(
        self,
        session: AsyncSession,
        encounter_id: int,
        *,
        limit: int | None = None,
        options: Sequence[_AbstractLoad] | None = None,
    ) -> Sequence[models.EncounterResultAudit]:
        query = self._apply_options(
            self.select()
            .where(models.EncounterResultAudit.encounter_id == encounter_id)
            .order_by(
                models.EncounterResultAudit.created_at.desc(),
                models.EncounterResultAudit.id.desc(),
            ),
            options,
        )
        if limit is not None:
            query = query.limit(limit)
        result = await session.execute(query)
        return result.unique().scalars().all()

    async def list_with_actor(
        self, session: AsyncSession, encounter_id: int, *, limit: int
    ) -> Sequence[tuple[models.EncounterResultAudit, str | None, int | None]]:
        """The result half of the room journal: newest first, each row with its
        actor's display name and -- for a per-game row -- the series position it
        decided.

        ``actor_user_id`` is a PLAYER identity (``identity.user``), not the auth
        account the room journal names, so the name comes from a different table
        than :meth:`EncounterRoomEventRepository.list_with_actor`'s and the two
        are merged by the reader. Both joins are LEFT OUTER: a series-level row
        has no game, an imported or cascaded one has no actor, and a deleted
        account must not erase what it decided.
        """
        result = await session.execute(
            sa.select(self.model, models.User.name, models.EncounterGame.position)
            .outerjoin(models.User, models.User.id == self.model.actor_user_id)
            .outerjoin(models.EncounterGame, models.EncounterGame.id == self.model.game_id)
            .where(self.model.encounter_id == encounter_id)
            .order_by(self.model.created_at.desc(), self.model.id.desc())
            .limit(limit)
        )
        return result.tuples().all()


class EncounterRoomEventRepository(BaseRepository[models.EncounterRoomEvent]):
    def __init__(self) -> None:
        super().__init__(models.EncounterRoomEvent)

    async def list_with_actor(
        self, session: AsyncSession, encounter_id: int, *, limit: int
    ) -> Sequence[tuple[models.EncounterRoomEvent, str | None]]:
        """The room half of the journal: newest first, each row with its actor's
        account name. LEFT OUTER -- a clock/engine row has no actor at all."""
        result = await session.execute(
            sa.select(self.model, models.AuthUser.username)
            .outerjoin(models.AuthUser, models.AuthUser.id == self.model.actor_auth_user_id)
            .where(self.model.encounter_id == encounter_id)
            .order_by(self.model.created_at.desc(), self.model.id.desc())
            .limit(limit)
        )
        return result.tuples().all()


class EncounterReportFormRepository(BaseRepository[models.EncounterReportForm]):
    def __init__(self) -> None:
        super().__init__(models.EncounterReportForm)

    async def get_by_tournament(self, session: AsyncSession, tournament_id: int) -> models.EncounterReportForm | None:
        return await self.get_by(session, tournament_id=tournament_id)


class EncounterSavedViewRepository(BaseRepository[models.EncounterSavedView]):
    def __init__(self) -> None:
        super().__init__(models.EncounterSavedView)

    async def list_for_user(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        auth_user_id: int,
    ) -> Sequence[models.EncounterSavedView]:
        result = await session.execute(
            self.select()
            .where(
                models.EncounterSavedView.workspace_id == workspace_id,
                models.EncounterSavedView.auth_user_id == auth_user_id,
            )
            .order_by(
                models.EncounterSavedView.sort_order.asc(),
                models.EncounterSavedView.created_at.asc(),
            )
        )
        return result.scalars().all()

    async def get_owned(
        self,
        session: AsyncSession,
        *,
        saved_view_id: int,
        workspace_id: int,
        auth_user_id: int,
    ) -> models.EncounterSavedView | None:
        return await self.get_by(
            session,
            id=saved_view_id,
            workspace_id=workspace_id,
            auth_user_id=auth_user_id,
        )


class EncounterLinkRepository(BaseRepository[models.EncounterLink]):
    """``encounter_link`` — bracket wiring between a source and a target encounter."""

    def __init__(self) -> None:
        super().__init__(models.EncounterLink)

    async def list_by_source_ids(
        self, session: AsyncSession, source_encounter_ids: Sequence[int]
    ) -> Sequence[models.EncounterLink]:
        if not source_encounter_ids:
            return []
        result = await session.execute(
            self.select().where(models.EncounterLink.source_encounter_id.in_(tuple(source_encounter_ids)))
        )
        return result.scalars().all()


__all__ = (
    "EncounterGameRepository",
    "EncounterLinkRepository",
    "EncounterReportFormRepository",
    "EncounterResultAuditRepository",
    "EncounterRoomEventRepository",
    "EncounterSavedViewRepository",
)
