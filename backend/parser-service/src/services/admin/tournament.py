"""Admin service layer for tournament CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas.admin import tournament as admin_schemas


async def create_tournament(session: AsyncSession, data: admin_schemas.TournamentCreate) -> models.Tournament:
    """Create a new tournament"""
    if data.number is not None:
        result = await session.execute(
            select(models.Tournament).where(
                models.Tournament.number == data.number,
                models.Tournament.is_league == data.is_league,
            )
        )
        existing_tournament = result.scalar_one_or_none()

        if existing_tournament:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tournament with this number already exists",
            )

    tournament = models.Tournament(**data.model_dump())

    session.add(tournament)
    await session.commit()
    await session.refresh(tournament)

    return tournament


async def update_tournament(
    session: AsyncSession, tournament_id: int, data: admin_schemas.TournamentUpdate
) -> models.Tournament:
    """Update tournament fields"""
    # Fetch tournament
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(selectinload(models.Tournament.groups))
    )
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(tournament, field, value)

    await session.commit()
    await session.refresh(tournament)

    return tournament


async def delete_tournament(session: AsyncSession, tournament_id: int) -> None:
    """Delete tournament (cascade deletes groups, teams, etc.)"""
    result = await session.execute(select(models.Tournament).where(models.Tournament.id == tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    await session.delete(tournament)
    await session.commit()


async def toggle_finished(session: AsyncSession, tournament_id: int) -> models.Tournament:
    """Toggle tournament is_finished flag"""
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(selectinload(models.Tournament.groups))
    )
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    tournament.is_finished = not tournament.is_finished

    await session.commit()
    await session.refresh(tournament)

    return tournament


# ─── Tournament Group Management ─────────────────────────────────────────────


async def create_group(
    session: AsyncSession, tournament_id: int, data: admin_schemas.TournamentGroupCreate
) -> models.TournamentGroup:
    """Create a new tournament group"""
    # Verify tournament exists
    result = await session.execute(select(models.Tournament).where(models.Tournament.id == tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    # Create group
    group = models.TournamentGroup(tournament_id=tournament_id, **data.model_dump())

    session.add(group)
    await session.commit()
    await session.refresh(group)

    return group


async def update_group(
    session: AsyncSession, tournament_id: int, group_id: int, data: admin_schemas.TournamentGroupUpdate
) -> models.TournamentGroup:
    """Update tournament group"""
    result = await session.execute(
        select(models.TournamentGroup).where(
            models.TournamentGroup.id == group_id, models.TournamentGroup.tournament_id == tournament_id
        )
    )
    group = result.scalar_one_or_none()

    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament group not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(group, field, value)

    await session.commit()
    await session.refresh(group)

    return group


async def delete_group(session: AsyncSession, tournament_id: int, group_id: int) -> None:
    """Delete tournament group"""
    result = await session.execute(
        select(models.TournamentGroup).where(
            models.TournamentGroup.id == group_id, models.TournamentGroup.tournament_id == tournament_id
        )
    )
    group = result.scalar_one_or_none()

    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament group not found")

    await session.delete(group)
    await session.commit()
