"""Admin service layer for team and player CRUD operations"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas.admin import team as admin_schemas

# ─── Team CRUD ───────────────────────────────────────────────────────────────


async def get_team(session: AsyncSession, team_id: int) -> models.Team:
    """Get one team with captain, tournament, and roster loaded."""
    result = await session.execute(
        select(models.Team)
        .where(models.Team.id == team_id)
        .options(
            selectinload(models.Team.players).selectinload(models.Player.user),
            selectinload(models.Team.captain),
            selectinload(models.Team.tournament),
        )
    )
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    return team


async def create_team(session: AsyncSession, data: admin_schemas.TeamCreate) -> models.Team:
    """Create a new team"""
    # Verify tournament exists
    result = await session.execute(select(models.Tournament).where(models.Tournament.id == data.tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    # Verify captain exists
    result = await session.execute(select(models.User).where(models.User.id == data.captain_id))
    captain = result.scalar_one_or_none()

    if not captain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Captain user not found")

    # Create team
    team = models.Team(**data.model_dump())

    session.add(team)
    await session.commit()
    await session.refresh(team)

    return team


async def update_team(session: AsyncSession, team_id: int, data: admin_schemas.TeamUpdate) -> models.Team:
    """Update team fields"""
    result = await session.execute(
        select(models.Team)
        .where(models.Team.id == team_id)
        .options(selectinload(models.Team.players))
    )
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    # Verify captain exists if being updated
    if data.captain_id is not None:
        result = await session.execute(select(models.User).where(models.User.id == data.captain_id))
        captain = result.scalar_one_or_none()
        if not captain:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Captain user not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(team, field, value)

    await session.commit()
    await session.refresh(team)

    return team


async def delete_team(session: AsyncSession, team_id: int) -> None:
    """Delete team (cascade deletes players)"""
    result = await session.execute(select(models.Team).where(models.Team.id == team_id))
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    await session.delete(team)
    await session.commit()


# ─── Player Management ───────────────────────────────────────────────────────


async def add_player_to_team(
    session: AsyncSession, team_id: int, data: admin_schemas.PlayerCreate
) -> models.Player:
    """Add a player to a team"""
    # Verify team exists
    result = await session.execute(select(models.Team).where(models.Team.id == team_id))
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    # Verify user exists
    result = await session.execute(select(models.User).where(models.User.id == data.user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Override team_id from URL parameter
    player_data = data.model_dump()
    player_data["team_id"] = team_id

    # Create player
    player = models.Player(**player_data)

    session.add(player)
    await session.commit()
    await session.refresh(player)

    return player


async def remove_player_from_team(session: AsyncSession, team_id: int, player_id: int) -> None:
    """Remove a player from a team"""
    result = await session.execute(
        select(models.Player).where(
            models.Player.id == player_id,
            models.Player.team_id == team_id
        )
    )
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found in this team")

    await session.delete(player)
    await session.commit()


# ─── Player CRUD ─────────────────────────────────────────────────────────────


async def create_player(session: AsyncSession, data: admin_schemas.PlayerCreate) -> models.Player:
    """Create a new player"""
    # Verify user exists
    result = await session.execute(select(models.User).where(models.User.id == data.user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Verify team exists
    result = await session.execute(select(models.Team).where(models.Team.id == data.team_id))
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    # Create player
    player = models.Player(**data.model_dump())

    session.add(player)
    await session.commit()
    await session.refresh(player)

    return player


async def update_player(
    session: AsyncSession, player_id: int, data: admin_schemas.PlayerUpdate
) -> models.Player:
    """Update player fields"""
    result = await session.execute(
        select(models.Player)
        .where(models.Player.id == player_id)
        .options(selectinload(models.Player.user), selectinload(models.Player.team))
    )
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(player, field, value)

    await session.commit()
    await session.refresh(player)

    return player


async def delete_player(session: AsyncSession, player_id: int) -> None:
    """Delete player"""
    result = await session.execute(select(models.Player).where(models.Player.id == player_id))
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    await session.delete(player)
    await session.commit()
