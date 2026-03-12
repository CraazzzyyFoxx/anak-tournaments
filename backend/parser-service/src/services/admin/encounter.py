"""Admin service layer for encounter CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.core import enums
from src.schemas.admin import encounter as admin_schemas


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

    # Verify group if provided
    if data.tournament_group_id:
        result = await session.execute(
            select(models.TournamentGroup).where(models.TournamentGroup.id == data.tournament_group_id)
        )
        group = result.scalar_one_or_none()

        if not group:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament group not found")

    # Parse status
    try:
        encounter_status = enums.EncounterStatus(data.status)
    except ValueError:
        encounter_status = enums.EncounterStatus.OPEN

    # Create encounter
    encounter = models.Encounter(
        name=data.name,
        tournament_id=data.tournament_id,
        tournament_group_id=data.tournament_group_id,
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

    if "tournament_group_id" in update_data and update_data["tournament_group_id"] is not None:
        result = await session.execute(
            select(models.TournamentGroup).where(models.TournamentGroup.id == update_data["tournament_group_id"])
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tournament group not found",
            )

    # Handle status conversion
    if "status" in update_data:
        try:
            update_data["status"] = enums.EncounterStatus(update_data["status"])
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {', '.join([s.value for s in enums.EncounterStatus])}",
            )

    for field, value in update_data.items():
        setattr(encounter, field, value)

    await session.commit()
    await session.refresh(encounter)

    return encounter


async def delete_encounter(session: AsyncSession, encounter_id: int) -> None:
    """Delete encounter (cascade deletes matches)"""
    result = await session.execute(select(models.Encounter).where(models.Encounter.id == encounter_id))
    encounter = result.scalar_one_or_none()

    if not encounter:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encounter not found")

    await session.delete(encounter)
    await session.commit()
