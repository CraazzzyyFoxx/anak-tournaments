"""Admin service layer for encounter CRUD operations"""

from collections.abc import Iterable

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from src import models
from src.core import enums
from src.schemas.admin import encounter as admin_schemas
from src.services.encounter import veto_session as veto_session_service
from src.services.tournament.cache_invalidation import invalidate_tournament_cache
from src.services.tournament.events import (
    enqueue_tournament_recalculation,
)


async def _invalidate_encounter_reads(tournament_ids: Iterable[int]) -> None:
    """Clear encounter reads before an admin mutation returns to the client."""
    for tournament_id in sorted(set(tournament_ids)):
        try:
            await invalidate_tournament_cache(tournament_id, "bracket_changed")
        except Exception:
            logger.exception(
                "Failed to invalidate encounter cache after admin write",
                tournament_id=tournament_id,
            )


async def _resolve_stage_refs(
    session: AsyncSession,
    *,
    tournament_id: int,
    stage_id: int | None,
    stage_item_id: int | None,
    tournament_group_id: int | None,
) -> tuple[int, int | None, int | None]:
    resolved_group: models.TournamentGroup | None = None
    resolved_stage_item: models.StageItem | None = None

    if tournament_group_id is not None:
        result = await session.execute(
            select(models.TournamentGroup).where(
                models.TournamentGroup.id == tournament_group_id,
                models.TournamentGroup.tournament_id == tournament_id,
            )
        )
        resolved_group = result.scalar_one_or_none()
        if not resolved_group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tournament group not found",
            )
        if stage_id is None and resolved_group.stage_id is not None:
            stage_id = resolved_group.stage_id

    if stage_item_id is not None:
        result = await session.execute(
            select(models.StageItem)
            .where(models.StageItem.id == stage_item_id)
            .options(selectinload(models.StageItem.stage))
        )
        resolved_stage_item = result.scalar_one_or_none()
        if not resolved_stage_item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stage item not found",
            )
        if resolved_stage_item.stage.tournament_id != tournament_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stage item does not belong to this tournament",
            )
        if stage_id is None:
            stage_id = resolved_stage_item.stage_id
        elif stage_id != resolved_stage_item.stage_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stage item does not belong to the selected stage",
            )

    if stage_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Encounter must be linked to a stage",
        )

    result = await session.execute(
        select(models.Stage).where(
            models.Stage.id == stage_id,
            models.Stage.tournament_id == tournament_id,
        )
    )
    resolved_stage = result.scalar_one_or_none()
    if not resolved_stage:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stage not found")

    if resolved_group is None:
        if resolved_stage_item is not None:
            result = await session.execute(
                select(models.TournamentGroup).where(
                    models.TournamentGroup.tournament_id == tournament_id,
                    models.TournamentGroup.stage_id == resolved_stage.id,
                    models.TournamentGroup.name == resolved_stage_item.name,
                )
            )
            resolved_group = result.scalar_one_or_none()
        if resolved_group is None:
            result = await session.execute(
                select(models.TournamentGroup).where(
                    models.TournamentGroup.tournament_id == tournament_id,
                    models.TournamentGroup.stage_id == resolved_stage.id,
                )
            )
            groups = list(result.scalars().all())
            if len(groups) == 1:
                resolved_group = groups[0]

    return stage_id, stage_item_id, resolved_group.id if resolved_group else None


async def _require_team_in_tournament(
    session: AsyncSession, *, team_id: int, tournament_id: int, label: str
) -> models.Team:
    """Resolve a team and enforce that it belongs to the given tournament.

    Tenant-isolation guard: encounter/match writes are authorized against the
    encounter's own tournament workspace, so any team reference in the payload
    must live in that same tournament (mirrors the stage-refs validation).
    """
    result = await session.execute(select(models.Team).where(models.Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    if team.tournament_id != tournament_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label} does not belong to this tournament",
        )
    return team


def _reject_completed_status(new_status: str | None) -> None:
    """Completion is not a field edit.

    ``COMPLETED`` is now reachable only through the result endpoint, which moves
    ``status``, ``result_status``, the score and the audit row together. Letting
    a plain field update land it here is what allowed ``completed`` +
    ``disputed`` — a state no endpoint could repair.
    """
    if new_status is not None and new_status.lower() == enums.EncounterStatus.COMPLETED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "use_result_endpoint: complete an encounter via POST /api/v1/admin/encounters/{encounter_id}/result"
            ),
        )


async def create_encounter(session: AsyncSession, data: admin_schemas.EncounterCreate) -> models.Encounter:
    """Create a new encounter"""
    _reject_completed_status(data.status)

    # Verify tournament exists
    result = await session.execute(select(models.Tournament).where(models.Tournament.id == data.tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    # Verify selected teams exist and belong to this tournament when provided
    if data.home_team_id is not None:
        await _require_team_in_tournament(
            session, team_id=data.home_team_id, tournament_id=data.tournament_id, label="Home team"
        )

    if data.away_team_id is not None:
        await _require_team_in_tournament(
            session, team_id=data.away_team_id, tournament_id=data.tournament_id, label="Away team"
        )

    stage_id, stage_item_id, tournament_group_id = await _resolve_stage_refs(
        session,
        tournament_id=data.tournament_id,
        stage_id=data.stage_id,
        stage_item_id=data.stage_item_id,
        tournament_group_id=data.tournament_group_id,
    )

    # Parse status
    try:
        encounter_status = enums.EncounterStatus(data.status)
    except ValueError:
        encounter_status = enums.EncounterStatus.OPEN

    # Create encounter
    encounter = models.Encounter(
        name=data.name,
        tournament_id=data.tournament_id,
        tournament_group_id=tournament_group_id,
        stage_id=stage_id,
        stage_item_id=stage_item_id,
        home_team_id=data.home_team_id,
        away_team_id=data.away_team_id,
        round=data.round,
        best_of=data.best_of,
        home_score=data.home_score,
        away_score=data.away_score,
        status=encounter_status,
        scheduled_at=data.scheduled_at,
        started_at=data.started_at,
        ended_at=data.ended_at,
        current_map_index=data.current_map_index,
    )

    session.add(encounter)
    await enqueue_tournament_recalculation(session, data.tournament_id)
    await session.commit()
    await _invalidate_encounter_reads([data.tournament_id])
    await session.refresh(encounter)

    return encounter


async def update_encounter(
    session: AsyncSession, encounter_id: int, data: admin_schemas.EncounterUpdate
) -> models.Encounter:
    """Update encounter fields"""
    _reject_completed_status(data.status)

    result = await session.execute(
        select(models.Encounter)
        .where(models.Encounter.id == encounter_id)
        .options(
            selectinload(models.Encounter.home_team),
            selectinload(models.Encounter.away_team),
            selectinload(models.Encounter.tournament_group),
            selectinload(models.Encounter.stage),
            selectinload(models.Encounter.stage_item),
        )
        .with_for_update()
    )
    encounter = result.scalar_one_or_none()

    if not encounter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)

    if "home_team_id" in update_data and update_data["home_team_id"] is not None:
        await _require_team_in_tournament(
            session,
            team_id=update_data["home_team_id"],
            tournament_id=encounter.tournament_id,
            label="Home team",
        )

    if "away_team_id" in update_data and update_data["away_team_id"] is not None:
        await _require_team_in_tournament(
            session,
            team_id=update_data["away_team_id"],
            tournament_id=encounter.tournament_id,
            label="Away team",
        )

    resolved_stage_id, resolved_stage_item_id, resolved_group_id = await _resolve_stage_refs(
        session,
        tournament_id=encounter.tournament_id,
        stage_id=update_data.get("stage_id", encounter.stage_id),
        stage_item_id=update_data.get("stage_item_id", encounter.stage_item_id),
        tournament_group_id=update_data.get(
            "tournament_group_id",
            encounter.tournament_group_id,
        ),
    )
    update_data["stage_id"] = resolved_stage_id
    update_data["stage_item_id"] = resolved_stage_item_id
    update_data["tournament_group_id"] = resolved_group_id

    # Handle status conversion
    if "status" in update_data:
        try:
            update_data["status"] = enums.EncounterStatus(update_data["status"].lower())
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {', '.join([s.value for s in enums.EncounterStatus])}",
            )

    tournament_id = encounter.tournament_id
    previous_teams = (encounter.home_team_id, encounter.away_team_id)
    for field, value in update_data.items():
        setattr(encounter, field, value)

    if (encounter.home_team_id, encounter.away_team_id) != previous_teams:
        # Admin re-assigned a team slot: sync the veto session (ensure when
        # both teams are now known, reset a stale existing session).
        await veto_session_service.sync_veto_session_after_team_change(session, encounter)

    await enqueue_tournament_recalculation(session, tournament_id)
    await session.commit()
    await _invalidate_encounter_reads([tournament_id])
    await session.refresh(encounter)

    return encounter


async def update_match(
    session: AsyncSession,
    match_id: int,
    data: admin_schemas.MatchUpdate,
) -> models.Match:
    """Update a single Match (map) belonging to an encounter."""
    result = await session.execute(
        select(models.Match).where(models.Match.id == match_id).options(selectinload(models.Match.encounter))
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")

    update_data = data.model_dump(exclude_unset=True)

    match_tournament_id = match.encounter.tournament_id if match.encounter else None

    if "home_team_id" in update_data:
        if update_data["home_team_id"] is None or match_tournament_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Home team not found")
        await _require_team_in_tournament(
            session,
            team_id=update_data["home_team_id"],
            tournament_id=match_tournament_id,
            label="Home team",
        )
    if "away_team_id" in update_data:
        if update_data["away_team_id"] is None or match_tournament_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Away team not found")
        await _require_team_in_tournament(
            session,
            team_id=update_data["away_team_id"],
            tournament_id=match_tournament_id,
            label="Away team",
        )
    if "map_id" in update_data and update_data["map_id"] is not None:
        result = await session.execute(select(models.Map).where(models.Map.id == update_data["map_id"]))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Map not found")

    for field, value in update_data.items():
        setattr(match, field, value)

    tournament_id = match.encounter.tournament_id if match.encounter else None

    if tournament_id is not None:
        await enqueue_tournament_recalculation(session, tournament_id)
    await session.commit()
    if tournament_id is not None:
        await _invalidate_encounter_reads([tournament_id])
    await session.refresh(match)

    return match


async def delete_encounter(session: AsyncSession, encounter_id: int) -> None:
    """Delete encounter (cascade deletes matches)"""
    result = await session.execute(select(models.Encounter).where(models.Encounter.id == encounter_id))
    encounter = result.scalar_one_or_none()

    if not encounter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")

    tournament_id = encounter.tournament_id
    await session.delete(encounter)
    await enqueue_tournament_recalculation(session, tournament_id)
    await session.commit()
    await _invalidate_encounter_reads([tournament_id])
