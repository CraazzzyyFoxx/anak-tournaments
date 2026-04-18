"""Admin service layer for team and player CRUD operations"""

from fastapi import HTTPException, status
from shared.domain.player_sub_roles import normalize_sub_role
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas.admin import team as admin_schemas


def _prepare_player_create_data(data: admin_schemas.PlayerCreate) -> dict:
    player_data = data.model_dump()
    player_data.pop("div", None)
    player_data["sub_role"] = normalize_sub_role(player_data.get("sub_role"))
    return player_data


def _prepare_player_update_data(
    player: models.Player,
    data: admin_schemas.PlayerUpdate,
) -> dict:
    update_data = data.model_dump(exclude_unset=True)
    update_data.pop("div", None)
    if "sub_role" in update_data:
        update_data["sub_role"] = normalize_sub_role(update_data["sub_role"])
    return update_data


def _prepare_team_create_data(data: admin_schemas.TeamCreate) -> dict:
    team_data = data.model_dump()
    if team_data["balancer_name"] is None:
        team_data["balancer_name"] = team_data["name"]
    return team_data


def _prepare_team_update_data(team: models.Team, data: admin_schemas.TeamUpdate) -> dict:
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("balancer_name") is None and "balancer_name" in update_data:
        update_data["balancer_name"] = update_data.get("name") or team.name
    return update_data

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


async def get_player(session: AsyncSession, player_id: int) -> models.Player:
    result = await session.execute(
        select(models.Player)
        .where(models.Player.id == player_id)
        .options(
            selectinload(models.Player.user),
            selectinload(models.Player.tournament),
        )
    )
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Player not found",
        )

    return player


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
    team = models.Team(**_prepare_team_create_data(data))

    session.add(team)
    await session.commit()
    return await get_team(session, team.id)


async def update_team(session: AsyncSession, team_id: int, data: admin_schemas.TeamUpdate) -> models.Team:
    """Update team fields"""
    result = await session.execute(
        select(models.Team).where(models.Team.id == team_id).options(selectinload(models.Team.players))
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
    update_data = _prepare_team_update_data(team, data)
    for field, value in update_data.items():
        setattr(team, field, value)

    await session.commit()
    return await get_team(session, team.id)


async def delete_team(session: AsyncSession, team_id: int) -> None:
    """Delete team (cascade deletes players)"""
    result = await session.execute(select(models.Team).where(models.Team.id == team_id))
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    await session.execute(delete(models.Standing).where(models.Standing.team_id == team_id))
    await session.delete(team)
    await session.commit()


# ─── Player Management ───────────────────────────────────────────────────────


async def add_player_to_team(session: AsyncSession, team_id: int, data: admin_schemas.PlayerCreate) -> models.Player:
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
    player_data = _prepare_player_create_data(data)
    player_data["team_id"] = team_id

    # Create player
    player = models.Player(**player_data)

    session.add(player)
    await session.commit()
    return await get_player(session, player.id)


async def remove_player_from_team(session: AsyncSession, team_id: int, player_id: int) -> None:
    """Remove a player from a team"""
    result = await session.execute(
        select(models.Player).where(models.Player.id == player_id, models.Player.team_id == team_id)
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
    player = models.Player(**_prepare_player_create_data(data))

    session.add(player)
    await session.commit()
    return await get_player(session, player.id)


async def update_player(session: AsyncSession, player_id: int, data: admin_schemas.PlayerUpdate) -> models.Player:
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
    update_data = _prepare_player_update_data(player, data)
    for field, value in update_data.items():
        setattr(player, field, value)

    await session.commit()
    return await get_player(session, player.id)


async def delete_player(session: AsyncSession, player_id: int) -> None:
    """Delete player"""
    result = await session.execute(select(models.Player).where(models.Player.id == player_id))
    player = result.scalar_one_or_none()

    if not player:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    await session.delete(player)
    await session.commit()
