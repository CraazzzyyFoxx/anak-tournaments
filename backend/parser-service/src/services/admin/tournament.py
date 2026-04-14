"""Admin service layer for tournament CRUD operations"""

from urllib.parse import urlparse

from fastapi import HTTPException, status
from shared.core import tournament_state
from shared.core.enums import TournamentStatus
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models
from src.schemas.admin import tournament as admin_schemas
from src.services.challonge import service as challonge_service


def _normalize_challonge_slug(value: str) -> str:
    slug = value.strip()
    if not slug:
        return ""

    if "://" not in slug and "." not in slug:
        return slug.strip("/")

    candidate = slug if "://" in slug else f"https://{slug}"
    parsed = urlparse(candidate)
    if "challonge.com" in parsed.netloc:
        path = parsed.path.strip("/")
        if path:
            return path.split("/")[-1]

    return slug.strip("/").split("/")[-1]


async def get_tournament(session: AsyncSession, tournament_id: int) -> models.Tournament:
    """Get one tournament with stages loaded for admin workspaces."""
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(
            selectinload(models.Tournament.stages)
            .selectinload(models.Stage.items)
            .selectinload(models.StageItem.inputs)
        )
    )
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    return tournament


async def create_tournament(session: AsyncSession, data: admin_schemas.TournamentCreate) -> models.Tournament:
    """Create a new tournament"""
    if data.number is not None:
        result = await session.execute(
            select(models.Tournament).where(
                models.Tournament.workspace_id == data.workspace_id,
                models.Tournament.number == data.number,
                models.Tournament.is_league == data.is_league,
            )
        )
        existing_tournament = result.scalar_one_or_none()

        if existing_tournament:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tournament with this number already exists in this workspace",
            )

    if data.division_grid_version_id is not None:
        version_workspace = await session.scalar(
            select(models.DivisionGrid.workspace_id)
            .join(models.DivisionGridVersion, models.DivisionGridVersion.grid_id == models.DivisionGrid.id)
            .where(models.DivisionGridVersion.id == data.division_grid_version_id)
        )
        if version_workspace not in {None, data.workspace_id}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Division grid version does not belong to this workspace",
            )

    tournament = models.Tournament(**data.model_dump())

    session.add(tournament)
    await session.commit()
    return await get_tournament(session, tournament.id)


async def update_tournament(
    session: AsyncSession, tournament_id: int, data: admin_schemas.TournamentUpdate
) -> models.Tournament:
    """Update tournament fields"""
    # Fetch tournament
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(
            selectinload(models.Tournament.stages)
            .selectinload(models.Stage.items)
            .selectinload(models.StageItem.inputs)
        )
    )
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    if "challonge_slug" in update_data:
        raw_slug = update_data.pop("challonge_slug")
        if raw_slug:
            challonge_slug = _normalize_challonge_slug(raw_slug)
            challonge_tournament = await challonge_service.fetch_tournament(challonge_slug)
            tournament.challonge_slug = challonge_tournament.url
            tournament.challonge_id = challonge_tournament.id
        else:
            tournament.challonge_slug = None
            tournament.challonge_id = None

    if "division_grid_version_id" in update_data and update_data["division_grid_version_id"] is not None:
        version_workspace = await session.scalar(
            select(models.DivisionGrid.workspace_id)
            .join(models.DivisionGridVersion, models.DivisionGridVersion.grid_id == models.DivisionGrid.id)
            .where(models.DivisionGridVersion.id == update_data["division_grid_version_id"])
        )
        if version_workspace not in {None, tournament.workspace_id}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Division grid version does not belong to this workspace",
            )

    for field, value in update_data.items():
        setattr(tournament, field, value)

    await session.commit()
    return await get_tournament(session, tournament_id)


async def delete_tournament(session: AsyncSession, tournament_id: int) -> None:
    """Delete tournament (cascade deletes groups, teams, etc.)"""
    result = await session.execute(select(models.Tournament).where(models.Tournament.id == tournament_id))
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    await session.execute(delete(models.Standing).where(models.Standing.tournament_id == tournament_id))
    await session.delete(tournament)
    await session.commit()


async def toggle_finished(session: AsyncSession, tournament_id: int) -> models.Tournament:
    """Toggle tournament is_finished flag (legacy — prefer transition_status)"""
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(
            selectinload(models.Tournament.stages)
            .selectinload(models.Stage.items)
            .selectinload(models.StageItem.inputs)
        )
    )
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    tournament.is_finished = not tournament.is_finished
    tournament.status = (
        TournamentStatus.COMPLETED if tournament.is_finished else TournamentStatus.LIVE
    )

    await session.commit()
    return await get_tournament(session, tournament_id)


async def transition_status(
    session: AsyncSession,
    tournament_id: int,
    target_status: TournamentStatus,
    *,
    force: bool = False,
) -> models.Tournament:
    """Transition tournament to a new status with state machine validation."""
    result = await session.execute(
        select(models.Tournament)
        .where(models.Tournament.id == tournament_id)
        .options(
            selectinload(models.Tournament.stages)
            .selectinload(models.Stage.items)
            .selectinload(models.StageItem.inputs)
        )
    )
    tournament = result.scalar_one_or_none()

    if not tournament:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")

    if not force:
        tournament_state.validate_transition(tournament.status, target_status)

    tournament.status = target_status
    tournament.is_finished = tournament_state.is_finished_for_status(target_status)

    await session.commit()
    return await get_tournament(session, tournament_id)


# ─── Tournament Group Management ─────────────────────────────────────────────
