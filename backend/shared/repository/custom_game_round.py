"""Reads of the mix rounds recorded on the encounter layer (D74-D76).

A round is one ``encounter.encounter`` owned by a ``balancer.custom_game`` plus its ``balancer.custom_game_round`` row.
Who sat where is ``encounter.team_member`` (rated-dimension leaf in ``team_member_role``); what only
the balancer reads per member -- busy next door, the frozen rank delta -- is ``balancer.custom_game_round_member``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared import models
from shared.repository.base import BaseRepository

__all__ = ("CustomGameRoundRepository",)


class CustomGameRoundRepository(BaseRepository[models.CustomGameRound]):
    def __init__(self) -> None:
        super().__init__(models.CustomGameRound)

    def _of_game(self, custom_game_id: int) -> sa.Select[tuple[models.CustomGameRound]]:
        return (
            self.select()
            .join(models.Encounter, models.Encounter.id == models.CustomGameRound.encounter_id)
            .where(models.Encounter.custom_game_id == custom_game_id)
        )

    async def list_for_custom_game(
        self, session: AsyncSession, custom_game_id: int
    ) -> Sequence[models.CustomGameRound]:
        """Newest first, with what history and rotation read: the two seats, the game (map), the journal
        (recorder) and the per-member rows (played / busy). Eager: async sessions cannot lazy-load."""
        encounter = selectinload(models.CustomGameRound.encounter)
        result = await session.scalars(
            self._of_game(custom_game_id)
            .options(
                encounter.selectinload(models.Encounter.teams),
                encounter.selectinload(models.Encounter.games),
                encounter.selectinload(models.Encounter.result_audit),
                selectinload(models.CustomGameRound.members),
            )
            .order_by(models.CustomGameRound.encounter_id.desc())
        )
        return result.all()

    async def get_for_game(
        self, session: AsyncSession, custom_game_id: int, encounter_id: int
    ) -> models.CustomGameRound | None:
        """One round of this mix; ``None`` when the id belongs to another mix (ownership is part of the lookup)."""
        return await session.scalar(
            self._of_game(custom_game_id).where(models.CustomGameRound.encounter_id == encounter_id)
        )

    async def newest_id_for_lobby(self, session: AsyncSession, custom_game_id: int, lobby_index: int) -> int | None:
        """Ids follow recording order (the migration keeps it), so the newest round is the largest id."""
        return await session.scalar(
            sa.select(sa.func.max(models.CustomGameRound.encounter_id))
            .join(models.Encounter, models.Encounter.id == models.CustomGameRound.encounter_id)
            .where(models.Encounter.custom_game_id == custom_game_id, models.CustomGameRound.lobby_index == lobby_index)
        )

    async def activity_for_games(
        self, session: AsyncSession, custom_game_ids: Sequence[int]
    ) -> dict[int, tuple[int, datetime]]:
        """``custom_game_id -> (rounds recorded, newest round time)``; a mix with none is absent."""
        if not custom_game_ids:
            return {}
        rows = await session.execute(
            sa.select(
                models.Encounter.custom_game_id,
                sa.func.count().label("rounds"),
                sa.func.max(models.Encounter.created_at).label("last_at"),
            )
            .join(models.CustomGameRound, models.CustomGameRound.encounter_id == models.Encounter.id)
            .where(models.Encounter.custom_game_id.in_(custom_game_ids))
            .group_by(models.Encounter.custom_game_id)
        )
        return {row.custom_game_id: (row.rounds, row.last_at) for row in rows}

    async def activity_for_lobbies(self, session: AsyncSession, custom_game_id: int) -> dict[int, tuple[int, datetime]]:
        """``lobby_index -> (rounds recorded, newest round time)``; Discord's "game N" counts these."""
        rows = await session.execute(
            sa.select(
                models.CustomGameRound.lobby_index,
                sa.func.count().label("rounds"),
                sa.func.max(models.Encounter.created_at).label("last_at"),
            )
            .join(models.Encounter, models.Encounter.id == models.CustomGameRound.encounter_id)
            .where(models.Encounter.custom_game_id == custom_game_id)
            .group_by(models.CustomGameRound.lobby_index)
        )
        return {row.lobby_index: (row.rounds, row.last_at) for row in rows}

    @staticmethod
    def seat_rows_select(workspace_id: int) -> sa.Select:
        """The one seat join (unexecuted): a row per seat of this workspace's rounds, with its role, its frozen
        rank delta and both sides' scores -- a round stores two scores and no winner flag. A mix seat has at most
        one rated-dimension leaf, so the outer join never fans out. ``seats()`` executes it; the rank overview
        composes it as a subquery."""
        seat = models.EncounterTeamMember
        side = models.EncounterTeam
        other = aliased(models.EncounterTeam)
        role = models.EncounterTeamMemberRole
        member = models.CustomGameRoundMember
        return (
            sa.select(
                seat.id.label("seat_id"),
                models.Encounter.id.label("encounter_id"),
                models.Encounter.created_at,
                models.Encounter.custom_game_id,
                models.CustomGameRound.lobby_index,
                models.CustomGameRound.points_per_win_applied,
                side.slot,
                seat.workspace_member_id,
                role.role,
                seat.rank,
                member.rank_delta_applied,
                side.score.label("own_score"),
                other.score.label("other_score"),
            )
            .select_from(seat)
            .join(side, side.id == seat.encounter_team_id)
            .join(models.Encounter, models.Encounter.id == seat.encounter_id)
            .join(models.CustomGameRound, models.CustomGameRound.encounter_id == models.Encounter.id)
            .join(other, sa.and_(other.encounter_id == models.Encounter.id, other.id != side.id))
            .outerjoin(
                role,
                sa.and_(
                    role.team_member_id == seat.id,
                    role.dimension_id.in_(
                        sa.select(models.RoleDimension.id).where(
                            models.RoleDimension.discipline == models.Encounter.discipline,
                            models.RoleDimension.rated.is_(True),
                        )
                    ),
                ),
            )
            .outerjoin(
                member,
                sa.and_(
                    member.encounter_id == models.Encounter.id, member.workspace_member_id == seat.workspace_member_id
                ),
            )
            .where(models.Encounter.workspace_id == workspace_id)
        )

    async def seats(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        encounter_id: int | None = None,
        since: datetime | None = None,
    ) -> Sequence[sa.Row]:
        """``seat_rows_select`` of this workspace, oldest round first: the leaderboard, the ranker replay and
        undo all read this."""
        stmt = self.seat_rows_select(workspace_id).order_by(models.Encounter.id, models.EncounterTeamMember.id)
        if encounter_id is not None:
            stmt = stmt.where(models.Encounter.id == encounter_id)
        if since is not None:
            stmt = stmt.where(models.Encounter.created_at >= since)
        return (await session.execute(stmt)).all()

    async def delete_round(self, session: AsyncSession, encounter_id: int) -> None:
        """Undo (D76): the encounter goes, and seats, game, journal and ``custom_game_round*`` cascade with it."""
        await session.execute(sa.delete(models.Encounter).where(models.Encounter.id == encounter_id))
