"""Admin endpoints for managing tournament registration forms and registrations."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import NO_VALUE

from shared.balancer_registration_statuses import (
    StatusMeta,
    build_unknown_status_meta,
    get_status_metas_map,
)
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


def _loaded_relationship_or_none(instance: object, attribute: str) -> Any | None:
    loaded_value = sa.inspect(instance).attrs[attribute].loaded_value
    if loaded_value is NO_VALUE:
        return None
    return loaded_value


def _serialize_registration(
    registration: models.BalancerRegistration,
    *,
    status_meta_map: dict[str, dict[str, StatusMeta]] | None = None,
) -> admin_schemas.BalancerRegistrationRead:
    binding = _loaded_relationship_or_none(registration, "google_sheet_binding")
    roles = _loaded_relationship_or_none(registration, "roles") or []
    reviewer = _loaded_relationship_or_none(registration, "reviewer")
    checked_in_by_user = _loaded_relationship_or_none(registration, "checked_in_by_user")
    sorted_roles = sorted(roles, key=lambda item: (item.priority, item.role))
    resolved_status_meta = (
        status_meta_map["registration"].get(registration.status)
        if status_meta_map is not None
        else None
    ) or build_unknown_status_meta("registration", registration.status)
    resolved_balancer_status_meta = (
        status_meta_map["balancer"].get(registration.balancer_status)
        if status_meta_map is not None
        else None
    ) or build_unknown_status_meta("balancer", registration.balancer_status)
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
        is_flex=bool(sorted_roles) and all(role.is_primary for role in sorted_roles),
        status=registration.status,
        balancer_status=registration.balancer_status,
        status_meta=admin_schemas.StatusMetaRead(**resolved_status_meta),
        balancer_status_meta=admin_schemas.StatusMetaRead(**resolved_balancer_status_meta),
        exclude_from_balancer=registration.exclude_from_balancer,
        exclude_reason=registration.exclude_reason,
        checked_in=registration.checked_in,
        checked_in_at=registration.checked_in_at,
        checked_in_by_username=(
            checked_in_by_user.username
            if checked_in_by_user is not None
            else None
        ),
        deleted_at=registration.deleted_at,
        submitted_at=registration.submitted_at,
        reviewed_at=registration.reviewed_at,
        reviewed_by_username=reviewer.username if reviewer is not None else None,
        balancer_profile_overridden_at=registration.balancer_profile_overridden_at,
        roles=[_serialize_registration_role(role) for role in sorted_roles],
    )


# ---------------------------------------------------------------------------
# Form management
# ---------------------------------------------------------------------------


@router.get("/tournaments/{tournament_id}/registration-form", response_model=RegistrationFormRead | None)
async def get_registration_form(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "read")),
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
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "import")),
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
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "read")),
):
    registrations = await registration_service.list_registrations(
        session,
        tournament_id,
        status_filter=status_filter,
        inclusion_filter=inclusion_filter,
        source_filter=source_filter,
        include_deleted=include_deleted,
    )
    status_meta_map = await get_status_metas_map(
        session,
        workspace_id=registrations[0].workspace_id,
    ) if registrations else None
    return [
        _serialize_registration(registration, status_meta_map=status_meta_map)
        for registration in registrations
    ]


@router.post(
    "/tournaments/{tournament_id}/registrations",
    response_model=admin_schemas.BalancerRegistrationRead,
    status_code=201,
)
async def create_manual_registration(
    tournament_id: int,
    data: admin_schemas.BalancerRegistrationCreateRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "import")),
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
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.patch("/registrations/{registration_id}", response_model=admin_schemas.BalancerRegistrationRead)
async def update_registration(
    registration_id: int,
    data: admin_schemas.BalancerRegistrationUpdateRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "update")),
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
        status_value=data.status,
        balancer_status_value=data.balancer_status,
        roles=[role.model_dump() for role in data.roles] if data.roles is not None else None,
    )
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.patch("/registrations/{registration_id}/approve", response_model=admin_schemas.BalancerRegistrationRead)
async def approve_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "import")),
):
    registration = await registration_service.approve_registration(
        session,
        registration_id,
        reviewed_by=user.id,
    )
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.patch("/registrations/{registration_id}/reject", response_model=admin_schemas.BalancerRegistrationRead)
async def reject_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "import")),
):
    registration = await registration_service.reject_registration(
        session,
        registration_id,
        reviewed_by=user.id,
    )
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.patch("/registrations/{registration_id}/exclusion", response_model=admin_schemas.BalancerRegistrationRead)
async def set_registration_exclusion(
    registration_id: int,
    data: admin_schemas.BalancerRegistrationExclusionRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "update")),
):
    registration = await registration_service.set_registration_exclusion(
        session,
        registration_id,
        exclude_from_balancer=data.exclude_from_balancer,
        exclude_reason=data.exclude_reason,
    )
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.patch("/registrations/{registration_id}/withdraw", response_model=admin_schemas.BalancerRegistrationRead)
async def withdraw_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "update")),
):
    registration = await registration_service.withdraw_registration(session, registration_id)
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.patch("/registrations/{registration_id}/restore", response_model=admin_schemas.BalancerRegistrationRead)
async def restore_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "update")),
):
    registration = await registration_service.restore_registration(session, registration_id)
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.delete("/registrations/{registration_id}", status_code=204)
async def delete_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "import")),
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
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "import")),
):
    registration_ids = [int(registration_id) for registration_id in data.get("registration_ids", [])]
    approved, skipped = await registration_service.bulk_approve_registrations(
        session,
        tournament_id,
        registration_ids,
        reviewed_by=user.id,
    )
    return admin_schemas.BulkApproveResponse(approved=approved, skipped=skipped)


# ---------------------------------------------------------------------------
# Balancer status management
# ---------------------------------------------------------------------------


@router.patch("/registrations/{registration_id}/balancer-status", response_model=admin_schemas.BalancerRegistrationRead)
async def set_balancer_status(
    registration_id: int,
    data: admin_schemas.SetBalancerStatusRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "update")),
):
    registration = await registration_service.set_balancer_status(
        session,
        registration_id,
        balancer_status=data.balancer_status,
    )
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)


@router.post(
    "/tournaments/{tournament_id}/registrations/bulk-add-to-balancer",
    response_model=admin_schemas.BulkBalancerStatusResponse,
)
async def bulk_add_to_balancer(
    tournament_id: int,
    data: dict[str, Any],
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "import")),
):
    registration_ids = [int(rid) for rid in data.get("registration_ids", [])]
    balancer_status = data.get("balancer_status", "ready")
    updated, skipped = await registration_service.bulk_add_to_balancer(
        session,
        tournament_id,
        registration_ids,
        balancer_status=balancer_status,
    )
    return admin_schemas.BulkBalancerStatusResponse(updated=updated, skipped=skipped)


# ---------------------------------------------------------------------------
# Check-in management
# ---------------------------------------------------------------------------


@router.post(
    "/tournaments/{tournament_id}/registrations/export-users",
    response_model=admin_schemas.RegistrationUserExportResponse,
)
async def export_registrations_to_users(
    tournament_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_tournament_permission("team", "import")),
):
    result = await registration_service.export_registrations_to_users(session, tournament_id)
    return admin_schemas.RegistrationUserExportResponse(**result)


@router.patch("/registrations/{registration_id}/check-in", response_model=admin_schemas.BalancerRegistrationRead)
async def toggle_check_in(
    registration_id: int,
    data: admin_schemas.CheckInRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_registration_permission("team", "update")),
):
    if data.checked_in:
        registration = await registration_service.check_in_registration(
            session,
            registration_id,
            checked_in_by=user.id,
        )
    else:
        registration = await registration_service.uncheck_in_registration(
            session,
            registration_id,
        )
    status_meta_map = await get_status_metas_map(session, workspace_id=registration.workspace_id)
    return _serialize_registration(registration, status_meta_map=status_meta_map)
