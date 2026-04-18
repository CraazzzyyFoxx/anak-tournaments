"""Admin service layer for encounter CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.core import enums
from src.schemas.admin import encounter as admin_schemas
from src.services.standings import service as standings_service


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


async def create_encounter(session: AsyncSession, data: admin_schemas.EncounterCreate) -> models.Encounter:
    """Create a new encounter"""
    # Verify tournament exists
    result = await session.execute(select(models.Tournament).where(models.Tournament.id == data.tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    # Verify teams exist
    result = await session.execute(select(models.Team).where(models.Team.id == data.home_team_id))
    home_team = result.scalar_one_or_none()

    if not home_team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Home team not found")

    result = await session.execute(select(models.Team).where(models.Team.id == data.away_team_id))
    away_team = result.scalar_one_or_none()

    if not away_team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Away team not found")

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
        home_score=data.home_score,
        away_score=data.away_score,
        status=encounter_status,
    )

    session.add(encounter)
    await session.commit()
    await session.refresh(encounter)
    await standings_service.recalculate_for_tournament(session, data.tournament_id)
    await session.refresh(encounter)

    return encounter


async def update_encounter(
    session: AsyncSession, encounter_id: int, data: admin_schemas.EncounterUpdate
) -> models.Encounter:
    """Update encounter fields"""
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
    )
    encounter = result.scalar_one_or_none()

    if not encounter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)

    if "home_team_id" in update_data:
        result = await session.execute(select(models.Team).where(models.Team.id == update_data["home_team_id"]))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Home team not found")

    if "away_team_id" in update_data:
        result = await session.execute(select(models.Team).where(models.Team.id == update_data["away_team_id"]))
        if result.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Away team not found")

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
            update_data["status"] = enums.EncounterStatus(update_data["status"])
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {', '.join([s.value for s in enums.EncounterStatus])}",
            )

    tournament_id = encounter.tournament_id
    for field, value in update_data.items():
        setattr(encounter, field, value)

    await session.commit()
    await session.refresh(encounter)
    await standings_service.recalculate_for_tournament(session, tournament_id)
    await session.refresh(encounter)

    return encounter


async def delete_encounter(session: AsyncSession, encounter_id: int) -> None:
    """Delete encounter (cascade deletes matches)"""
    result = await session.execute(select(models.Encounter).where(models.Encounter.id == encounter_id))
    encounter = result.scalar_one_or_none()

    if not encounter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")

    tournament_id = encounter.tournament_id
    await session.delete(encounter)
    await session.commit()
    await standings_service.recalculate_for_tournament(session, tournament_id)
