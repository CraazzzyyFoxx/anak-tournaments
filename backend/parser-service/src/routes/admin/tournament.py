"""Admin routes for tournament CRUD operations"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src import models, schemas
from src.core import auth, db
from src.schemas.admin import tournament as admin_schemas
from src.services.challonge import service as challonge_service
from src.services.admin import tournament as admin_service
from src.services.tournament import flows as tournament_flows

router = APIRouter(
    prefix="/tournaments",
    tags=["admin", "tournaments"],
)


@router.post("", response_model=schemas.TournamentRead)
async def create_tournament(
    data: admin_schemas.TournamentCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "create")),
):
    """Create a new tournament (admin/organizer only)"""
    if not user.is_workspace_member(data.workspace_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this workspace",
        )
    tournament = await admin_service.create_tournament(session, data)
    return await tournament_flows.to_pydantic(session, tournament, ["groups"])


@router.get("/{tournament_id}", response_model=schemas.TournamentRead)
async def get_tournament(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "read")),
):
    """Get one tournament for admin workspace pages."""
    tournament = await admin_service.get_tournament(session, tournament_id)
    return await tournament_flows.to_pydantic(session, tournament, ["groups"])


@router.patch("/{tournament_id}", response_model=schemas.TournamentRead)
async def update_tournament(
    tournament_id: int,
    data: admin_schemas.TournamentUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Update tournament fields (admin/organizer only)"""
    tournament = await admin_service.update_tournament(session, tournament_id, data)
    return await tournament_flows.to_pydantic(session, tournament, ["groups"])


@router.delete("/{tournament_id}", status_code=204)
async def delete_tournament(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "delete")),
):
    """Delete tournament and all related data (admin/organizer only)"""
    await admin_service.delete_tournament(session, tournament_id)


@router.get("/challonge/lookup", response_model=schemas.ChallongeTournament)
async def lookup_challonge_tournament(
    slug: str,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Resolve Challonge metadata for linking tournament groups."""
    del session
    return await challonge_service.fetch_tournament(slug)


@router.post("/{tournament_id}/finish", response_model=schemas.TournamentRead)
async def toggle_tournament_finished(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Toggle tournament finished status (admin/organizer only)"""
    tournament = await admin_service.toggle_finished(session, tournament_id)
    return await tournament_flows.to_pydantic(session, tournament, ["groups"])


# ─── Tournament Group Management ─────────────────────────────────────────────


@router.post("/{tournament_id}/groups", response_model=schemas.TournamentGroupRead)
async def create_tournament_group(
    tournament_id: int,
    data: admin_schemas.TournamentGroupCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Create a new tournament group (admin/organizer only)"""
    group = await admin_service.create_group(session, tournament_id, data)
    return await tournament_flows.to_pydantic_group(session, group, [])


@router.patch("/{tournament_id}/groups/{group_id}", response_model=schemas.TournamentGroupRead)
async def update_tournament_group(
    tournament_id: int,
    group_id: int,
    data: admin_schemas.TournamentGroupUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Update tournament group (admin/organizer only)"""
    group = await admin_service.update_group(session, tournament_id, group_id, data)
    return await tournament_flows.to_pydantic_group(session, group, [])


@router.post("/{tournament_id}/groups/import-challonge", response_model=schemas.TournamentRead)
async def import_groups_from_challonge(
    tournament_id: int,
    slug: str,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Resolve a two-stage Challonge bracket and create all groups + playoffs automatically."""
    tournament = await admin_service.get_tournament(session, tournament_id)
    challonge_tournament = await challonge_service.fetch_tournament(slug)
    if challonge_tournament.grand_finals_modifier is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Challonge bracket does not have group stages enabled",
        )
    tournament.challonge_id = challonge_tournament.id
    tournament.challonge_slug = challonge_tournament.url
    await session.commit()
    await tournament_flows.create_groups(session, tournament, challonge_tournament)
    # re-fetch to include newly created groups
    tournament = await admin_service.get_tournament(session, tournament_id)
    return await tournament_flows.to_pydantic(session, tournament, ["groups"])


@router.delete("/{tournament_id}/groups/{group_id}", status_code=204)
async def delete_tournament_group(
    tournament_id: int,
    group_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("tournament", "update")),
):
    """Delete tournament group (admin/organizer only)"""
    await admin_service.delete_group(session, tournament_id, group_id)
