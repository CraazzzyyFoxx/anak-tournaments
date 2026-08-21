from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared import models
from shared.repository.base import BaseRepository


class TournamentRepository(BaseRepository[models.Tournament]):
    def __init__(self) -> None:
        super().__init__(models.Tournament)

    async def get_by_name(self, session: AsyncSession, name: str) -> models.Tournament | None:
        return await self.get_by(session, name=name)

    async def get_workspace_id(self, session: AsyncSession, tournament_id: int) -> int | None:
        """The owning workspace, without loading the rest of the row.

        A cheap scalar lookup for the common "does this tournament belong to
        that workspace" check (e.g. the stream-svc repoll ownership guard),
        which never needs anything but this one column.
        """
        return await session.scalar(
            sa.select(models.Tournament.workspace_id).where(models.Tournament.id == tournament_id)
        )

    async def list_by_workspace(
        self,
        session: AsyncSession,
        workspace_id: int,
    ) -> Sequence[models.Tournament]:
        result = await session.execute(
            sa.select(models.Tournament)
            .where(models.Tournament.workspace_id == workspace_id)
            .order_by(models.Tournament.id.desc())
        )
        return result.scalars().all()


class StageRepository(BaseRepository[models.Stage]):
    def __init__(self) -> None:
        super().__init__(models.Stage)

    async def list_by_tournament(self, session: AsyncSession, tournament_id: int) -> Sequence[models.Stage]:
        result = await session.execute(
            sa.select(models.Stage)
            .where(models.Stage.tournament_id == tournament_id)
            .order_by(models.Stage.order.asc(), models.Stage.id.asc())
        )
        return result.scalars().all()


class StageItemRepository(BaseRepository[models.StageItem]):
    def __init__(self) -> None:
        super().__init__(models.StageItem)

    async def list_by_stage(self, session: AsyncSession, stage_id: int) -> Sequence[models.StageItem]:
        result = await session.execute(
            sa.select(models.StageItem)
            .where(models.StageItem.stage_id == stage_id)
            .order_by(models.StageItem.order.asc(), models.StageItem.id.asc())
        )
        return result.scalars().all()


class TeamRepository(BaseRepository[models.Team]):
    def __init__(self) -> None:
        super().__init__(models.Team)

    async def get_by_name_and_tournament(
        self,
        session: AsyncSession,
        *,
        name: str,
        tournament_id: int,
    ) -> models.Team | None:
        return await self.get_by(session, name=name, tournament_id=tournament_id)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.Team]:
        result = await session.execute(
            sa.select(models.Team)
            .options(selectinload(models.Team.players))
            .where(models.Team.tournament_id == tournament_id)
            .order_by(models.Team.id.asc())
        )
        return result.unique().scalars().all()


class PlayerRepository(BaseRepository[models.Player]):
    def __init__(self) -> None:
        super().__init__(models.Player)

    async def get_by_user_and_tournament(
        self,
        session: AsyncSession,
        *,
        user_id: int,
        tournament_id: int,
    ) -> models.Player | None:
        return await self.get_by(session, user_id=user_id, tournament_id=tournament_id)

    async def list_by_team(self, session: AsyncSession, team_id: int) -> Sequence[models.Player]:
        result = await session.execute(
            sa.select(models.Player).where(models.Player.team_id == team_id).order_by(models.Player.id.asc())
        )
        return result.scalars().all()


class EncounterRepository(BaseRepository[models.Encounter]):
    def __init__(self) -> None:
        super().__init__(models.Encounter)

    async def get_by_challonge_id(
        self,
        session: AsyncSession,
        challonge_id: int,
    ) -> models.Encounter | None:
        return await self.get_by(session, challonge_id=challonge_id)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.Encounter]:
        result = await session.execute(
            sa.select(models.Encounter)
            .where(models.Encounter.tournament_id == tournament_id)
            .order_by(models.Encounter.round.asc(), models.Encounter.id.asc())
        )
        return result.scalars().all()


class MatchRepository(BaseRepository[models.Match]):
    def __init__(self) -> None:
        super().__init__(models.Match)

    async def list_by_encounter(self, session: AsyncSession, encounter_id: int) -> Sequence[models.Match]:
        result = await session.execute(
            sa.select(models.Match).where(models.Match.encounter_id == encounter_id).order_by(models.Match.id.asc())
        )
        return result.scalars().all()


class StandingRepository(BaseRepository[models.Standing]):
    def __init__(self) -> None:
        super().__init__(models.Standing)

    async def list_by_tournament(
        self,
        session: AsyncSession,
        tournament_id: int,
    ) -> Sequence[models.Standing]:
        result = await session.execute(
            sa.select(models.Standing)
            .where(models.Standing.tournament_id == tournament_id)
            .order_by(models.Standing.position.asc(), models.Standing.id.asc())
        )
        return result.scalars().all()


class TournamentLinkRepository(BaseRepository[models.TournamentLink]):
    """``tournament.tournament_link`` — typed external links (Discord, stream, VOD, ...).

    Read-heavy by every current caller (app-service renders them, stream-svc polls
    the ``kind='stream'`` ones), so both methods below are read paths; nothing here
    writes.
    """

    def __init__(self) -> None:
        super().__init__(models.TournamentLink)

    async def list_active_by_kind(
        self,
        session: AsyncSession,
        tournament_id: int,
        kind: str,
    ) -> Sequence[models.TournamentLink]:
        """Active links of ``kind``, in organizer order."""
        result = await session.execute(
            sa.select(models.TournamentLink)
            .where(
                models.TournamentLink.tournament_id == tournament_id,
                models.TournamentLink.kind == kind,
                models.TournamentLink.is_active.is_(True),
            )
            .order_by(models.TournamentLink.sort_order.asc(), models.TournamentLink.id.asc())
        )
        return result.scalars().all()

    async def list_active_by_kind_bulk(
        self,
        session: AsyncSession,
        tournament_ids: Sequence[int],
        kind: str,
    ) -> dict[int, list[models.TournamentLink]]:
        """``list_active_by_kind`` for every id in ``tournament_ids`` in ONE query.

        A caller that needs this for many tournaments in the same pass (the
        stream-svc poll tick, one per active tournament) would otherwise pay one
        round-trip per tournament for the exact same statement shape.
        """
        by_tournament: dict[int, list[models.TournamentLink]] = {tid: [] for tid in tournament_ids}
        if not tournament_ids:
            return by_tournament
        result = await session.execute(
            sa.select(models.TournamentLink)
            .where(
                models.TournamentLink.tournament_id.in_(tournament_ids),
                models.TournamentLink.kind == kind,
                models.TournamentLink.is_active.is_(True),
            )
            .order_by(models.TournamentLink.sort_order.asc(), models.TournamentLink.id.asc())
        )
        for link in result.scalars().all():
            by_tournament.setdefault(link.tournament_id, []).append(link)
        return by_tournament
