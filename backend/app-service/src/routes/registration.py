"""Public registration endpoints for tournament sign-up."""

from __future__ import annotations

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import auth, db
from src.schemas.registration import (
    RegistrationCreate,
    RegistrationFormRead,
    RegistrationRead,
    RegistrationRoleRead,
    RegistrationStatusResponse,
    RegistrationUpdate,
)
from src.services.registration import service as reg_service

router = APIRouter(
    prefix="/workspaces/{workspace_id}/tournaments/{tournament_id}/registration",
    tags=["registration"],
)


def _form_to_read(form: models.BalancerRegistrationForm) -> RegistrationFormRead:
    return RegistrationFormRead(
        id=form.id,
        tournament_id=form.tournament_id,
        workspace_id=form.workspace_id,
        is_open=form.is_open,
        auto_approve=form.auto_approve,
        opens_at=form.opens_at,
        closes_at=form.closes_at,
        built_in_fields=form.built_in_fields_json or {},
        custom_fields=form.custom_fields_json or [],
    )


def _reg_to_read(reg: models.BalancerRegistration) -> RegistrationRead:
    roles = [
        RegistrationRoleRead(
            role=r.role,
            subrole=r.subrole,
            is_primary=r.is_primary,
            priority=r.priority,
        )
        for r in sorted(reg.roles, key=lambda r: (not r.is_primary, r.priority))
    ] if reg.roles else []

    return RegistrationRead(
        id=reg.id,
        tournament_id=reg.tournament_id,
        workspace_id=reg.workspace_id,
        auth_user_id=reg.auth_user_id,
        user_id=reg.user_id,
        battle_tag=reg.battle_tag,
        smurf_tags_json=reg.smurf_tags_json,
        discord_nick=reg.discord_nick,
        twitch_nick=reg.twitch_nick,
        stream_pov=reg.stream_pov,
        roles=roles,
        notes=reg.notes,
        custom_fields_json=reg.custom_fields_json,
        status=reg.status,
        submitted_at=reg.submitted_at,
        reviewed_at=reg.reviewed_at,
    )


@router.get("/form", response_model=RegistrationFormRead | None)
async def get_registration_form(
    workspace_id: int,
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    """Get the registration form config for a tournament (public)."""
    form = await reg_service.get_registration_form(session, tournament_id)
    if form is None:
        return None
    return _form_to_read(form)


@router.post("", response_model=RegistrationRead, status_code=201)
async def register(
    workspace_id: int,
    tournament_id: int,
    data: RegistrationCreate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    """Register the current user for a tournament."""
    form = await reg_service.get_registration_form(session, tournament_id)
    if form is None or not form.is_open:
        raise HTTPException(status_code=400, detail="Registration is not open for this tournament")

    if form.workspace_id != workspace_id:
        raise HTTPException(status_code=400, detail="Tournament does not belong to this workspace")

    existing = await reg_service.get_registration(session, tournament_id, user.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Already registered for this tournament")

    # Resolve player profile from auth_user (explicit query to avoid lazy load)
    user_player_id: int | None = None
    link_result = await session.execute(
        sa.select(models.AuthUserPlayer).where(
            models.AuthUserPlayer.auth_user_id == user.id,
            models.AuthUserPlayer.is_primary.is_(True),
        )
    )
    primary_link = link_result.scalar_one_or_none()
    if primary_link is not None:
        user_player_id = primary_link.player_id

    # Build role entries for normalized table
    role_entries: list[models.BalancerRegistrationRole] = []
    if data.roles:
        for i, r in enumerate(data.roles):
            role_entries.append(models.BalancerRegistrationRole(
                role=r.role,
                subrole=r.subrole,
                is_primary=r.is_primary,
                priority=i,
            ))

    registration = await reg_service.create_registration(
        session,
        tournament_id=tournament_id,
        workspace_id=workspace_id,
        auth_user_id=user.id,
        user_id=user_player_id,
        battle_tag=data.battle_tag,
        smurf_tags=data.smurf_tags,
        discord_nick=data.discord_nick,
        twitch_nick=data.twitch_nick,
        stream_pov=data.stream_pov,
        notes=data.notes,
        custom_fields=data.custom_fields,
        auto_approve=form.auto_approve,
    )

    # Write normalized roles
    for entry in role_entries:
        entry.registration_id = registration.id
        session.add(entry)
    await session.commit()

    # Re-fetch with roles eagerly loaded
    from sqlalchemy.orm import selectinload
    result = await session.execute(
        sa.select(models.BalancerRegistration)
        .where(models.BalancerRegistration.id == registration.id)
        .options(selectinload(models.BalancerRegistration.roles))
    )
    registration = result.scalar_one()

    return _reg_to_read(registration)


@router.get("/me", response_model=RegistrationRead | None)
async def get_my_registration(
    workspace_id: int,
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    """Get the current user's registration for a tournament."""
    reg = await reg_service.get_registration(session, tournament_id, user.id)
    if reg is None:
        return None
    return _reg_to_read(reg)


@router.patch("/me", response_model=RegistrationRead)
async def update_my_registration(
    workspace_id: int,
    tournament_id: int,
    data: RegistrationUpdate,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    """Update the current user's registration (only while status is pending)."""
    reg = await reg_service.get_registration(session, tournament_id, user.id)
    if reg is None:
        raise HTTPException(status_code=404, detail="No registration found")
    if reg.status != "pending":
        raise HTTPException(status_code=400, detail="Cannot update a registration that is not pending")

    updated = await reg_service.update_registration(
        session,
        reg,
        **data.model_dump(exclude_unset=True),
    )
    return _reg_to_read(updated)


@router.delete("/me", response_model=RegistrationStatusResponse)
async def withdraw_my_registration(
    workspace_id: int,
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.get_current_active_user),
):
    """Withdraw (delete) the current user's registration."""
    reg = await reg_service.get_registration(session, tournament_id, user.id)
    if reg is None:
        raise HTTPException(status_code=404, detail="No registration found")

    await reg_service.withdraw_registration(session, reg)
    return RegistrationStatusResponse(status="deleted", message="Registration deleted")


@router.get("/list", response_model=list[RegistrationRead])
async def list_registrations(
    workspace_id: int,
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
):
    """Public list of approved registrations for a tournament."""
    from sqlalchemy.orm import selectinload
    result = await session.execute(
        sa.select(models.BalancerRegistration)
        .where(
            models.BalancerRegistration.tournament_id == tournament_id,
            models.BalancerRegistration.workspace_id == workspace_id,
            models.BalancerRegistration.status == "approved",
        )
        .options(selectinload(models.BalancerRegistration.roles))
        .order_by(models.BalancerRegistration.submitted_at.asc())
    )
    return [_reg_to_read(r) for r in result.scalars().all()]
