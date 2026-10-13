"""Reads of the mix rounds recorded on the encounter layer (D74-D76).

A round is one ``encounter.encounter`` owned by a ``balancer.custom_game`` plus its ``balancer.mix_round`` row.
Who sat where is ``encounter.team_member`` (role in ``team_member_role``, dimension ``player_role``); what only
the balancer reads per member -- busy next door, the frozen rank delta -- is ``balancer.mix_round_member``.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from shared import models
from shared.repository.base import BaseRepository

__all__ = ("MIX_ROLE_DIMENSION", "MixRoundRepository", "winner_slot")

#: The role dimension a mix seat is recorded under (D67).
MIX_ROLE_DIMENSION = "player_role"


def winner_slot(slot: int, own_score: float, other_score: float) -> int | None:
    """The winning slot (1 | 2) of a round, ``None`` for a draw -- the one place that reads it off the scores.

    ``slot`` is the side ``own_score`` belongs to (a ``seats()`` row's ``slot``/``own_score``/``other_score``; for a
    round's two teams pass slot 1 with the first team's score first).
    """
    if own_score == other_score:
        return None
    return slot if own_score > other_score else 3 - slot


class MixRoundRepository(BaseRepository[models.MixRound]):
    def __init__(self) -> None:
        super().__init__(models.MixRound)

    def _of_game(self, custom_game_id: int) -> sa.Select[tuple[models.MixRound]]:
        return (
            self.select()
            .join(models.Encounter, models.Encounter.id == models.MixRound.encounter_id)
            .where(models.Encounter.custom_game_id == custom_game_id)
        )

    async def list_for_custom_game(self, session: AsyncSession, custom_game_id: int) -> Sequence[models.MixRound]:
        """Newest first, with what history and rotation read: the two seats, the game (map), the journal
        (recorder) and the per-member rows (played / busy). Eager: async sessions cannot lazy-load."""
        encounter = selectinload(models.MixRound.encounter)
        result = await session.scalars(
            self._of_game(custom_game_id)
            .options(
                encounter.selectinload(models.Encounter.teams),
                encounter.selectinload(models.Encounter.games),
                encounter.selectinload(models.Encounter.result_audit),
                selectinload(models.MixRound.members),
            )
            .order_by(models.MixRound.encounter_id.desc())
        )
        return result.all()

    async def get_for_game(
        self, session: AsyncSession, custom_game_id: int, encounter_id: int
    ) -> models.MixRound | None:
        """One round of this mix; ``None`` when the id belongs to another mix (ownership is part of the lookup)."""
        return await session.scalar(self._of_game(custom_game_id).where(models.MixRound.encounter_id == encounter_id))

    async def newest_id_for_lobby(self, session: AsyncSession, custom_game_id: int, lobby_index: int) -> int | None:
        """Ids follow recording order (the migration keeps it), so the newest round is the largest id."""
        return await session.scalar(
            sa.select(sa.func.max(models.MixRound.encounter_id))
            .join(models.Encounter, models.Encounter.id == models.MixRound.encounter_id)
            .where(models.Encounter.custom_game_id == custom_game_id, models.MixRound.lobby_index == lobby_index)
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
            .join(models.MixRound, models.MixRound.encounter_id == models.Encounter.id)
            .where(models.Encounter.custom_game_id.in_(custom_game_ids))
            .group_by(models.Encounter.custom_game_id)
        )
        return {row.custom_game_id: (row.rounds, row.last_at) for row in rows}

    async def activity_for_lobbies(self, session: AsyncSession, custom_game_id: int) -> dict[int, tuple[int, datetime]]:
        """``lobby_index -> (rounds recorded, newest round time)``; Discord's "game N" counts these."""
        rows = await session.execute(
            sa.select(
                models.MixRound.lobby_index,
                sa.func.count().label("rounds"),
                sa.func.max(models.Encounter.created_at).label("last_at"),
            )
            .join(models.Encounter, models.Encounter.id == models.MixRound.encounter_id)
            .where(models.Encounter.custom_game_id == custom_game_id)
            .group_by(models.MixRound.lobby_index)
        )
        return {row.lobby_index: (row.rounds, row.last_at) for row in rows}

    async def seats(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        encounter_id: int | None = None,
        since: datetime | None = None,
    ) -> Sequence[sa.Row]:
        """One row per seat of this workspace's rounds, oldest round first: the leaderboard, the ranker replay
        and undo all read this. The other side's score rides on the row because a round stores two scores and
        no winner flag. A mix seat has at most one ``player_role`` row, so the outer join never fans out."""
        seat = models.EncounterTeamMember
        side = models.EncounterTeam
        other = aliased(models.EncounterTeam)
        role = models.EncounterTeamMemberRole
        member = models.MixRoundMember
        stmt = (
            sa.select(
                models.Encounter.id.label("encounter_id"),
                models.Encounter.created_at,
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
            .join(models.MixRound, models.MixRound.encounter_id == models.Encounter.id)
            .join(other, sa.and_(other.encounter_id == models.Encounter.id, other.id != side.id))
            .outerjoin(role, sa.and_(role.team_member_id == seat.id, role.dimension == MIX_ROLE_DIMENSION))
            .outerjoin(
                member,
                sa.and_(
                    member.encounter_id == models.Encounter.id, member.workspace_member_id == seat.workspace_member_id
                ),
            )
            .where(models.Encounter.workspace_id == workspace_id)
            .order_by(models.Encounter.id, seat.id)
        )
        if encounter_id is not None:
            stmt = stmt.where(models.Encounter.id == encounter_id)
        if since is not None:
            stmt = stmt.where(models.Encounter.created_at >= since)
        return (await session.execute(stmt)).all()

    async def delete_round(self, session: AsyncSession, encounter_id: int) -> None:
        """Undo (D76): the encounter goes, and seats, game, journal and ``mix_round*`` cascade with it."""
        await session.execute(sa.delete(models.Encounter).where(models.Encounter.id == encounter_id))
