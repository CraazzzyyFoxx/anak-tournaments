"""Workspace resolution and the discipline boundary of the achievement-rule admin surface.

Every achievement mutation and manual evaluation passes this boundary first: the explicit discipline must be enabled
for the workspace, and every character/tournament/match/rule reference a request names must belong to that workspace
*and* discipline. Nothing here defaults or guesses a game.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.models.achievements.achievement import AchievementRule
from shared.repository import TournamentRepository, WorkspaceRepository
from shared.repository.stats import StatsMatchRepository
from shared.services.ontology import assert_discipline_enabled
from src import models

_workspace_repo = WorkspaceRepository()
_tournament_repo = TournamentRepository()
_match_repo = StatsMatchRepository()


def validation_failure(errors: Any) -> HTTPException:
    """The 400 for a rule definition or a portable batch that failed validation.

    The message names every problem (a missing entity, a foreign game) that the organizer must fix; the structured list
    rides ``details`` for machine readers.
    """

    def line(item: Any) -> str:
        if isinstance(item, dict):
            return f"{item.get('slug')}: " + "; ".join(map(str, item.get("errors") or ()))
        return str(item)

    items = errors if isinstance(errors, list) else [errors]
    exc = HTTPException(status_code=400, detail={"msg": " | ".join(line(i) for i in items), "code": "invalid_rule"})
    exc.details = {"validation_errors": errors}  # type: ignore[attr-defined]
    return exc


async def get_workspace_or_404(session: AsyncSession, workspace_id: int) -> models.Workspace:
    workspace = await _workspace_repo.get(session, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return workspace


def visible_workspace_ids(user: models.AuthUser, target_workspace_id: int) -> list[int] | None:
    if user.is_superuser:
        return None
    return [workspace_id for workspace_id in user.get_workspace_ids() if workspace_id != target_workspace_id]


async def get_source_workspace_or_404(
    session: AsyncSession,
    *,
    target_workspace_id: int,
    source_workspace_id: int,
    user: models.AuthUser,
) -> models.Workspace:
    if source_workspace_id == target_workspace_id:
        raise HTTPException(status_code=400, detail="Source and target workspace must be different")

    workspace = await _workspace_repo.get(session, source_workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Source workspace not found")
    if not user.is_superuser and source_workspace_id not in user.get_workspace_ids():
        raise HTTPException(status_code=403, detail="Source workspace is not accessible")
    return workspace


async def get_workspace_for_discipline(session: AsyncSession, workspace_id: int, discipline: str) -> models.Workspace:
    """The workspace, 404 when absent, 422 when ``discipline`` is not enabled for it."""
    workspace = await get_workspace_or_404(session, workspace_id)
    assert_discipline_enabled(workspace, discipline)
    return workspace


async def require_character(session: AsyncSession, *, discipline: str, entity_id: int | None) -> None:
    """A rule's linked entity is a ``character`` of the rule's own discipline; anything else is a boundary error."""
    if entity_id is None:
        return
    found = await session.scalar(
        sa.select(
            sa.exists().where(
                models.CatalogEntity.id == entity_id,
                models.CatalogEntity.kind == "character",
                models.CatalogEntity.discipline == discipline,
            )
        )
    )
    if not found:
        raise HTTPException(
            status_code=422,
            detail=f"entity_id: character #{entity_id} does not exist in discipline {discipline!r}",
        )


async def require_tournament(
    session: AsyncSession, *, workspace_id: int, discipline: str, tournament_id: int | None
) -> models.Tournament | None:
    """A referenced tournament lives in the workspace (404 otherwise) and in ``discipline`` (422 otherwise)."""
    if tournament_id is None:
        return None
    tournament = await _tournament_repo.get(session, tournament_id)
    if tournament is None or tournament.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Tournament not found")
    if tournament.discipline != discipline:
        raise HTTPException(
            status_code=422,
            detail=f"tournament #{tournament_id} belongs to discipline {tournament.discipline!r}, not {discipline!r}",
        )
    return tournament


async def require_scope_refs(
    session: AsyncSession,
    *,
    workspace_id: int,
    discipline: str,
    tournament_id: int | None = None,
    match_id: int | None = None,
) -> None:
    """Tournament and/or match references of one request, same workspace and discipline; both must agree."""
    await require_tournament(session, workspace_id=workspace_id, discipline=discipline, tournament_id=tournament_id)
    if match_id is None:
        return
    match = await _match_repo.get(session, match_id)
    if match is None or match.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.discipline != discipline:
        raise HTTPException(
            status_code=422, detail=f"match #{match_id} belongs to discipline {match.discipline!r}, not {discipline!r}"
        )
    if tournament_id is not None:
        owner = await session.scalar(
            sa.select(models.Encounter.tournament_id).where(models.Encounter.id == match.encounter_id)
        )
        if owner != tournament_id:
            raise HTTPException(status_code=422, detail=f"match #{match_id} is not part of tournament #{tournament_id}")


async def resolve_rule_ids(
    session: AsyncSession, *, workspace_id: int, discipline: str, rule_ids: list[int] | None
) -> list[int]:
    """Concrete rule ids a manual run covers: explicit ids must all be this workspace's rules of ``discipline``
    (404 otherwise), no ids means every *enabled* rule of the discipline. ``[]`` stays an empty selection."""
    query = sa.select(AchievementRule.id).where(
        AchievementRule.workspace_id == workspace_id, AchievementRule.discipline == discipline
    )
    if rule_ids is None:
        return list(await session.scalars(query.where(AchievementRule.enabled.is_(True)).order_by(AchievementRule.id)))
    found = set(await session.scalars(query.where(AchievementRule.id.in_(rule_ids))))
    if missing := sorted(set(rule_ids) - found):
        raise HTTPException(status_code=404, detail=f"Rules not found in this workspace and discipline: {missing}")
    return sorted(found)
