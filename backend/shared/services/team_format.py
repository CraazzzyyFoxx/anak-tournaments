"""Team formats at runtime: load an owner's format, copy one at creation, save an organizer's edit,
and project the slots the balancer and the draft fill.

Every tournament and mix gets its own copy when it is created.
A row-less owner -- a tournament a test or a script inserted directly -- reads what its copy would hold: the workspace
default for its discipline, else the module's default preset.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.disciplines import DISCIPLINES
from shared.domain.roster_shape import RosterShape
from shared.domain.team_format import (
    FormatDimension,
    FormatRule,
    TeamFormat,
    TeamFormatError,
    check_team_format,
    slot_shape,
)
from shared.repository import CatalogRoleRepository, TeamFormatRepository, TournamentRepository
from shared.schemas.roster_slots import RosterShapeRead
from shared.schemas.team_format import TeamFormatRead

__all__ = (
    "FormatSource",
    "copy_for_custom_game",
    "copy_for_tournament",
    "custom_game_format",
    "custom_game_slot_shape",
    "save_tournament_format",
    "save_workspace_format",
    "team_format_of",
    "team_format_read",
    "tournament_format",
    "tournament_shape_reads",
    "tournament_slot_shape",
    "workspace_format",
    "workspace_slot_shape",
)

FormatSource = Literal["tournament", "custom_game", "workspace", "preset"]

_formats = TeamFormatRepository()
_roles = CatalogRoleRepository()
_tournaments = TournamentRepository()


def team_format_of(row: models.RosterTeamFormat) -> TeamFormat:
    rules = sorted(row.rules, key=lambda rule: (rule.role.sort_order, rule.role.code))
    return TeamFormat(
        discipline=row.discipline,
        name=row.name,
        starter_min=row.starter_min,
        starter_max=row.starter_max,
        substitute_min=row.substitute_min,
        substitute_max=row.substitute_max,
        dimensions=tuple(
            FormatDimension(
                entry.dimension.code, entry.mode, entry.player_min_assignments, entry.player_max_assignments
            )
            for entry in sorted(row.dimensions, key=lambda entry: entry.dimension.sort_order)
        ),
        rules=tuple(
            FormatRule(
                rule.role.dimension.code,
                rule.role.code,
                rule.hard_min,
                rule.hard_max,
                rule.recommended_min,
                rule.recommended_max,
                rule.include_descendants,
            )
            for rule in rules
        ),
        preset_code=row.preset_code,
    )


async def workspace_format(
    session: AsyncSession, *, workspace_id: int, discipline: str
) -> tuple[TeamFormat, FormatSource]:
    row = await _formats.workspace_default(session, workspace_id=workspace_id, discipline=discipline)
    if row is not None:
        return team_format_of(row), "workspace"
    return TeamFormat.from_preset(discipline, DISCIPLINES[discipline].preset()), "preset"


async def tournament_format(session: AsyncSession, tournament: Any) -> tuple[TeamFormat, FormatSource]:
    row = await _formats.for_tournament(session, tournament.id)
    if row is not None:
        return team_format_of(row), "tournament"
    return await workspace_format(session, workspace_id=tournament.workspace_id, discipline=tournament.discipline)


async def custom_game_format(session: AsyncSession, game: Any) -> tuple[TeamFormat, FormatSource]:
    row = await _formats.for_custom_game(session, game.id)
    if row is not None:
        return team_format_of(row), "custom_game"
    return await workspace_format(session, workspace_id=game.workspace_id, discipline=game.discipline)


async def _shape(session: AsyncSession, team_format: TeamFormat, workspace_id: int) -> RosterShape:
    ontology = await _roles.ontology(session, discipline=team_format.discipline, workspace_id=workspace_id)
    return slot_shape(team_format, ontology)


async def workspace_slot_shape(session: AsyncSession, *, workspace_id: int, discipline: str) -> RosterShape:
    team_format, _ = await workspace_format(session, workspace_id=workspace_id, discipline=discipline)
    return await _shape(session, team_format, workspace_id)


async def tournament_slot_shape(session: AsyncSession, tournament_id: int) -> RosterShape:
    tournament = await _tournaments.get(session, tournament_id)
    if tournament is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
    team_format, _ = await tournament_format(session, tournament)
    return await _shape(session, team_format, tournament.workspace_id)


async def custom_game_slot_shape(session: AsyncSession, game: Any) -> RosterShape:
    team_format, _ = await custom_game_format(session, game)
    return await _shape(session, team_format, game.workspace_id)


async def tournament_shape_reads(session: AsyncSession, tournaments: Sequence[Any]) -> dict[int, RosterShapeRead]:
    """One page of tournaments: their formats in one query, one ontology per (discipline, workspace)."""
    rows = await _formats.for_tournaments(session, [tournament.id for tournament in tournaments])
    ontologies: dict[tuple[str, int], Any] = {}
    reads: dict[int, RosterShapeRead] = {}
    for tournament in tournaments:
        row = rows.get(tournament.id)
        if row is not None:
            team_format, source = team_format_of(row), "tournament"
        else:
            team_format, source = await workspace_format(
                session, workspace_id=tournament.workspace_id, discipline=tournament.discipline
            )
        key = (tournament.discipline, tournament.workspace_id)
        if key not in ontologies:
            ontologies[key] = await _roles.ontology(session, discipline=key[0], workspace_id=key[1])
        ontology = ontologies[key]
        reads[tournament.id] = RosterShapeRead.from_shape(
            slot_shape(team_format, ontology), source=source, dimension=ontology.rated.code
        )
    return reads


async def team_format_read(
    session: AsyncSession, team_format: TeamFormat, *, source: FormatSource, workspace_id: int
) -> TeamFormatRead:
    ontology = await _roles.ontology(session, discipline=team_format.discipline, workspace_id=workspace_id)
    return TeamFormatRead.from_domain(team_format, source=source, ontology=ontology)


async def _save(
    session: AsyncSession,
    team_format: TeamFormat,
    *,
    workspace_id: int,
    tournament_id: int | None = None,
    custom_game_id: int | None = None,
) -> None:
    ontology = await _roles.ontology(session, discipline=team_format.discipline, workspace_id=workspace_id)
    try:
        check_team_format(team_format, ontology)
    except TeamFormatError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await _formats.save(
        session,
        workspace_id=workspace_id,
        discipline=team_format.discipline,
        tournament_id=tournament_id,
        custom_game_id=custom_game_id,
        team_format=team_format,
        ontology=ontology,
    )


async def copy_for_tournament(session: AsyncSession, tournament: Any) -> None:
    """A new tournament gets a copy of its workspace's default (else the preset); template edits never reach it."""
    team_format, _ = await workspace_format(
        session, workspace_id=tournament.workspace_id, discipline=tournament.discipline
    )
    await _save(session, team_format, workspace_id=tournament.workspace_id, tournament_id=tournament.id)


async def copy_for_custom_game(
    session: AsyncSession, game: Any, *, preset_code: str | None = None, source_game_id: int | None = None
) -> None:
    """A mix freezes its format at creation -- the host's preset, a clone's format, else the workspace default."""
    if preset_code is not None:
        try:
            preset = DISCIPLINES[game.discipline].preset(preset_code)
        except LookupError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        team_format = TeamFormat.from_preset(game.discipline, preset)
    else:
        source = None if source_game_id is None else await _formats.for_custom_game(session, source_game_id)
        if source is not None:
            team_format = team_format_of(source)
        else:
            team_format, _ = await workspace_format(session, workspace_id=game.workspace_id, discipline=game.discipline)
    await _save(session, team_format, workspace_id=game.workspace_id, custom_game_id=game.id)


async def save_tournament_format(session: AsyncSession, tournament: Any, team_format: TeamFormat) -> None:
    await _save(session, team_format, workspace_id=tournament.workspace_id, tournament_id=tournament.id)


async def save_workspace_format(
    session: AsyncSession, *, workspace_id: int, discipline: str, team_format: TeamFormat
) -> None:
    await _save(session, team_format, workspace_id=workspace_id)
