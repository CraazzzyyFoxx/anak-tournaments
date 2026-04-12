"""Admin endpoints for managing tournament registration forms and registrations."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import auth, db
from src.schemas.admin import balancer as admin_schemas
from src.schemas.admin.registration_form import (
    RegistrationFormRead,
    RegistrationFormUpsert,
)
from src.services.admin import balancer_registration as registration_service

router = APIRouter(
    prefix="/balancer",
    tags=["admin", "registration"],
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)


def _serialize_registration_role(
    role: models.BalancerRegistrationRole,
) -> admin_schemas.BalancerRegistrationRoleRead:
    return admin_schemas.BalancerRegistrationRoleRead(
        role=role.role,
        subrole=role.subrole,
        priority=role.priority,
        is_primary=role.is_primary,
        rank_value=role.rank_value,
        is_active=role.is_active,
    )


def _serialize_registration(
    registration: models.BalancerRegistration,
) -> admin_schemas.BalancerRegistrationRead:
    binding = registration.google_sheet_binding
    return admin_schemas.BalancerRegistrationRead(
        id=registration.id,
        tournament_id=registration.tournament_id,
        workspace_id=registration.workspace_id,
        auth_user_id=registration.auth_user_id,
        user_id=registration.user_id,
        display_name=registration.display_name,
        battle_tag=registration.battle_tag,
        battle_tag_normalized=registration.battle_tag_normalized,
        source="google_sheets" if binding is not None else "manual",
        source_record_key=binding.source_record_key if binding is not None else None,
        smurf_tags_json=registration.smurf_tags_json or [],
        discord_nick=registration.discord_nick,
        twitch_nick=registration.twitch_nick,
        stream_pov=registration.stream_pov,
        notes=registration.notes,
        admin_notes=registration.admin_notes,
        custom_fields_json=registration.custom_fields_json,
        is_flex=registration.is_flex,
        status=registration.status,
        exclude_from_balancer=registration.exclude_from_balancer,
        exclude_reason=registration.exclude_reason,
        deleted_at=registration.deleted_at,
        submitted_at=registration.submitted_at,
        reviewed_at=registration.reviewed_at,
        reviewed_by_username=registration.reviewer.username if registration.reviewer else None,
        balancer_profile_overridden_at=registration.balancer_profile_overridden_at,
        roles=[
            _serialize_registration_role(role)
            for role in sorted(registration.roles, key=lambda item: (item.priority, item.role))
        ],
    )


# ---------------------------------------------------------------------------
# Form management
# ---------------------------------------------------------------------------


@router.get("/tournaments/{tournament_id}/registration-form", response_model=RegistrationFormRead | None)
async def get_registration_form(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    result = await session.execute(
        sa.select(models.BalancerRegistrationForm).where(
            models.BalancerRegistrationForm.tournament_id == tournament_id
        )
    )
    form = result.scalar_one_or_none()
    if form is None:
        return None
    return RegistrationFormRead.model_validate(form, from_attributes=True)


@router.put("/tournaments/{tournament_id}/registration-form", response_model=RegistrationFormRead)
async def upsert_registration_form(
    tournament_id: int,
    data: RegistrationFormUpsert,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    tournament = await registration_service.ensure_tournament_exists(session, tournament_id)

    result = await session.execute(
        sa.select(models.BalancerRegistrationForm).where(
            models.BalancerRegistrationForm.tournament_id == tournament_id
        )
    )
    form = result.scalar_one_or_none()

    built_in_fields_json = {key: value.model_dump(exclude_none=True) for key, value in data.built_in_fields.items()}
    custom_fields_json = [field.model_dump(exclude_none=True) for field in data.custom_fields]

    if form is None:
        form = models.BalancerRegistrationForm(
            tournament_id=tournament_id,
            workspace_id=tournament.workspace_id,
            is_open=data.is_open,
            auto_approve=data.auto_approve,
            opens_at=data.opens_at,
            closes_at=data.closes_at,
            built_in_fields_json=built_in_fields_json,
            custom_fields_json=custom_fields_json,
        )
        session.add(form)
    else:
        form.is_open = data.is_open
        form.auto_approve = data.auto_approve
        form.opens_at = data.opens_at
        form.closes_at = data.closes_at
        form.built_in_fields_json = built_in_fields_json
        form.custom_fields_json = custom_fields_json

    await session.commit()
    await session.refresh(form)
    return RegistrationFormRead.model_validate(form, from_attributes=True)


# ---------------------------------------------------------------------------
# Registration management
# ---------------------------------------------------------------------------


@router.get("/tournaments/{tournament_id}/registrations", response_model=list[admin_schemas.BalancerRegistrationRead])
async def list_registrations(
    tournament_id: int,
    status_filter: str | None = None,
    inclusion_filter: str | None = None,
    source_filter: str | None = None,
    include_deleted: bool = False,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    registrations = await registration_service.list_registrations(
        session,
        tournament_id,
        status_filter=status_filter,
        inclusion_filter=inclusion_filter,
        source_filter=source_filter,
        include_deleted=include_deleted,
    )
    return [_serialize_registration(registration) for registration in registrations]


@router.post(
    "/tournaments/{tournament_id}/registrations",
    response_model=admin_schemas.BalancerRegistrationRead,
    status_code=201,
)
async def create_manual_registration(
    tournament_id: int,
    data: admin_schemas.BalancerRegistrationCreateRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    tournament = await registration_service.ensure_tournament_exists(session, tournament_id)
    registration = await registration_service.create_manual_registration(
        session,
        tournament_id=tournament_id,
        workspace_id=tournament.workspace_id,
        display_name=data.display_name,
        battle_tag=data.battle_tag,
        smurf_tags_json=data.smurf_tags_json,
        discord_nick=data.discord_nick,
        twitch_nick=data.twitch_nick,
        stream_pov=data.stream_pov,
        notes=data.notes,
        admin_notes=data.admin_notes,
        is_flex=data.is_flex,
        roles=[role.model_dump() for role in data.roles],
    )
    return _serialize_registration(registration)


@router.patch("/registrations/{registration_id}", response_model=admin_schemas.BalancerRegistrationRead)
async def update_registration(
    registration_id: int,
    data: admin_schemas.BalancerRegistrationUpdateRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "update")),
):
    registration = await registration_service.update_registration_profile(
        session,
        registration_id,
        display_name=data.display_name,
        battle_tag=data.battle_tag,
        smurf_tags_json=data.smurf_tags_json,
        discord_nick=data.discord_nick,
        twitch_nick=data.twitch_nick,
        stream_pov=data.stream_pov,
        notes=data.notes,
        admin_notes=data.admin_notes,
        is_flex=data.is_flex,
        roles=[role.model_dump() for role in data.roles] if data.roles is not None else None,
    )
    return _serialize_registration(registration)


@router.patch("/registrations/{registration_id}/approve", response_model=admin_schemas.BalancerRegistrationRead)
async def approve_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    registration = await registration_service.approve_registration(
        session,
        registration_id,
        reviewed_by=user.id,
    )
    return _serialize_registration(registration)


@router.patch("/registrations/{registration_id}/reject", response_model=admin_schemas.BalancerRegistrationRead)
async def reject_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    registration = await registration_service.reject_registration(
        session,
        registration_id,
        reviewed_by=user.id,
    )
    return _serialize_registration(registration)


@router.patch("/registrations/{registration_id}/exclusion", response_model=admin_schemas.BalancerRegistrationRead)
async def set_registration_exclusion(
    registration_id: int,
    data: admin_schemas.BalancerRegistrationExclusionRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "update")),
):
    registration = await registration_service.set_registration_exclusion(
        session,
        registration_id,
        exclude_from_balancer=data.exclude_from_balancer,
        exclude_reason=data.exclude_reason,
    )
    return _serialize_registration(registration)


@router.patch("/registrations/{registration_id}/withdraw", response_model=admin_schemas.BalancerRegistrationRead)
async def withdraw_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "update")),
):
    registration = await registration_service.withdraw_registration(session, registration_id)
    return _serialize_registration(registration)


@router.patch("/registrations/{registration_id}/restore", response_model=admin_schemas.BalancerRegistrationRead)
async def restore_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "update")),
):
    registration = await registration_service.restore_registration(session, registration_id)
    return _serialize_registration(registration)


@router.delete("/registrations/{registration_id}", status_code=204)
async def delete_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    await registration_service.soft_delete_registration(
        session,
        registration_id,
        deleted_by=user.id,
    )


@router.post(
    "/tournaments/{tournament_id}/registrations/bulk-approve",
    response_model=admin_schemas.BulkApproveResponse,
)
async def bulk_approve_registrations(
    tournament_id: int,
    data: dict[str, Any],
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    registration_ids = [int(registration_id) for registration_id in data.get("registration_ids", [])]
    approved, skipped = await registration_service.bulk_approve_registrations(
        session,
        tournament_id,
        registration_ids,
        reviewed_by=user.id,
    )
    return admin_schemas.BulkApproveResponse(approved=approved, skipped=skipped)
