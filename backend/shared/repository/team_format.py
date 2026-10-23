"""``roster.team_format`` and its children."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.domain.roles import Ontology
from shared.domain.team_format import TeamFormat
from shared.repository.base import BaseRepository

__all__ = ("TeamFormatRepository",)


class TeamFormatRepository(BaseRepository[models.RosterTeamFormat]):
    def __init__(self) -> None:
        super().__init__(models.RosterTeamFormat)

    async def for_tournament(self, session: AsyncSession, tournament_id: int) -> models.RosterTeamFormat | None:
        return await self.get_by(session, tournament_id=tournament_id)

    async def for_custom_game(self, session: AsyncSession, custom_game_id: int) -> models.RosterTeamFormat | None:
        return await self.get_by(session, custom_game_id=custom_game_id)

    async def for_tournaments(
        self, session: AsyncSession, tournament_ids: Sequence[int]
    ) -> dict[int, models.RosterTeamFormat]:
        rows = (await session.scalars(self.select().where(self.model.tournament_id.in_(list(tournament_ids))))).all()
        return {row.tournament_id: row for row in rows if row.tournament_id is not None}

    async def workspace_default(
        self, session: AsyncSession, *, workspace_id: int, discipline: str
    ) -> models.RosterTeamFormat | None:
        row = self.model
        return (
            await session.scalars(
                self.select().where(
                    row.workspace_id == workspace_id,
                    row.discipline == discipline,
                    row.tournament_id.is_(None),
                    row.custom_game_id.is_(None),
                )
            )
        ).first()

    async def save(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        discipline: str,
        tournament_id: int | None = None,
        custom_game_id: int | None = None,
        team_format: TeamFormat,
        ontology: Ontology,
    ) -> models.RosterTeamFormat:
        """Create the owner's format or replace it whole. ``team_format`` must already pass ``check_team_format``."""
        if tournament_id is not None:
            row = await self.for_tournament(session, tournament_id)
        elif custom_game_id is not None:
            row = await self.for_custom_game(session, custom_game_id)
        else:
            row = await self.workspace_default(session, workspace_id=workspace_id, discipline=discipline)
        if row is None:
            row = await self.create(
                session,
                models.RosterTeamFormat(
                    workspace_id=workspace_id,
                    discipline=discipline,
                    tournament_id=tournament_id,
                    custom_game_id=custom_game_id,
                    name=team_format.name,
                    starter_min=team_format.starter_min,
                    starter_max=team_format.starter_max,
                ),
            )
        row.preset_code = team_format.preset_code
        row.name = team_format.name
        row.starter_min, row.starter_max = team_format.starter_min, team_format.starter_max
        row.substitute_min, row.substitute_max = team_format.substitute_min, team_format.substitute_max
        # Children are replaced whole: rules first, they reference the dimension rows.
        await session.execute(
            sa.delete(models.RosterFormatRoleRule).where(models.RosterFormatRoleRule.team_format_id == row.id)
        )
        await session.execute(
            sa.delete(models.RosterTeamFormatDimension).where(models.RosterTeamFormatDimension.team_format_id == row.id)
        )
        if team_format.dimensions:
            await session.execute(
                sa.insert(models.RosterTeamFormatDimension),
                [
                    {
                        "team_format_id": row.id,
                        "discipline": discipline,
                        "dimension_id": ontology.dimensions[entry.dimension].id,
                        "mode": entry.mode,
                        "player_min_assignments": entry.player_min_assignments,
                        "player_max_assignments": entry.player_max_assignments,
                    }
                    for entry in team_format.dimensions
                ],
            )
        if team_format.rules:
            await session.execute(
                sa.insert(models.RosterFormatRoleRule),
                [
                    {
                        "team_format_id": row.id,
                        "dimension_id": ontology.dimensions[rule.dimension].id,
                        "role_id": ontology.node(rule.dimension, rule.role).id,
                        "hard_min": rule.hard_min,
                        "hard_max": rule.hard_max,
                        "recommended_min": rule.recommended_min,
                        "recommended_max": rule.recommended_max,
                        "include_descendants": rule.include_descendants,
                    }
                    for rule in team_format.rules
                ],
            )
        await session.flush()
        await session.refresh(row, ["dimensions", "rules"])
        return row
