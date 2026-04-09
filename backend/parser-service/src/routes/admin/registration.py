"""Admin endpoints for managing tournament registration forms and registrations."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sqlalchemy.orm import selectinload

from src import models
from src.core import auth, db
from src.services.admin import balancer as balancer_service

router = APIRouter(
    prefix="/balancer",
    tags=["admin", "registration"],
    dependencies=[Depends(auth.require_any_role("admin", "tournament_organizer"))],
)


# ---------------------------------------------------------------------------
# Schemas (admin-specific, kept local to the route module)
# ---------------------------------------------------------------------------


class CustomFieldDef(BaseModel):
    key: str
    label: str
    type: str = "text"
    required: bool = False
    placeholder: str | None = None
    options: list[str] | None = None


class BuiltInFieldConfig(BaseModel):
    enabled: bool = True
    required: bool = False


class RegistrationFormUpsert(BaseModel):
    is_open: bool = False
    auto_approve: bool = False
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    built_in_fields: dict[str, BuiltInFieldConfig] = Field(default_factory=dict)
    custom_fields: list[CustomFieldDef] = Field(default_factory=list)


class RegistrationFormRead(BaseModel):
    id: int
    tournament_id: int
    workspace_id: int
    is_open: bool
    auto_approve: bool = False
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    built_in_fields_json: dict[str, Any]
    custom_fields_json: list[dict[str, Any]]


class RegistrationRoleRead(BaseModel):
    role: str
    subrole: str | None = None
    is_primary: bool = False
    priority: int = 0


class RegistrationRead(BaseModel):
    id: int
    tournament_id: int
    workspace_id: int
    auth_user_id: int | None = None
    user_id: int | None = None
    battle_tag: str | None = None
    smurf_tags_json: list[str] | None = None
    discord_nick: str | None = None
    twitch_nick: str | None = None
    stream_pov: bool = False
    roles: list[RegistrationRoleRead] = Field(default_factory=list)
    notes: str | None = None
    custom_fields_json: dict[str, Any] | None = None
    status: str
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None
    reviewed_by_username: str | None = None


class ApproveResponse(BaseModel):
    registration_id: int
    status: str
    application_id: int | None = None
    player_id: int | None = None


class BulkApproveRequest(BaseModel):
    registration_ids: list[int]


class BulkApproveResponse(BaseModel):
    approved: int
    skipped: int


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
    await balancer_service.ensure_tournament_exists(session, tournament_id)

    # Resolve workspace_id from tournament
    t_result = await session.execute(
        sa.select(models.Tournament.workspace_id).where(models.Tournament.id == tournament_id)
    )
    workspace_id = t_result.scalar_one()

    result = await session.execute(
        sa.select(models.BalancerRegistrationForm).where(
            models.BalancerRegistrationForm.tournament_id == tournament_id
        )
    )
    form = result.scalar_one_or_none()

    built_in_fields_json = {k: v.model_dump() for k, v in data.built_in_fields.items()}
    custom_fields_json = [f.model_dump() for f in data.custom_fields]

    if form is None:
        form = models.BalancerRegistrationForm(
            tournament_id=tournament_id,
            workspace_id=workspace_id,
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


@router.get("/tournaments/{tournament_id}/registrations", response_model=list[RegistrationRead])
async def list_registrations(
    tournament_id: int,
    status_filter: str | None = None,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "read")),
):
    query = (
        sa.select(models.BalancerRegistration)
        .where(models.BalancerRegistration.tournament_id == tournament_id)
        .options(
            selectinload(models.BalancerRegistration.roles),
            selectinload(models.BalancerRegistration.reviewer),
        )
        .order_by(models.BalancerRegistration.submitted_at.desc())
    )
    if status_filter:
        query = query.where(models.BalancerRegistration.status == status_filter)
    result = await session.execute(query)
    return [_reg_to_read(r) for r in result.scalars().all()]


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
        reviewed_by_username=reg.reviewer.username if reg.reviewer else None,
    )


@router.patch("/registrations/{registration_id}/approve", response_model=ApproveResponse)
async def approve_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    result = await session.execute(
        sa.select(models.BalancerRegistration).where(
            models.BalancerRegistration.id == registration_id
        )
    )
    reg = result.scalar_one_or_none()
    if reg is None:
        raise HTTPException(status_code=404, detail="Registration not found")
    if reg.status != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot approve registration with status '{reg.status}'")

    reg.status = "approved"
    reg.reviewed_at = datetime.now(UTC)
    reg.reviewed_by = user.id

    # Create BalancerApplication from registration (if sheet exists)
    sheet = await balancer_service.get_tournament_sheet(session, reg.tournament_id)
    application: models.BalancerApplication | None = None
    player: models.BalancerPlayer | None = None

    if sheet is not None and reg.battle_tag:
        bt_normalized = balancer_service.normalize_battle_tag_key(reg.battle_tag)

        # Check if application already exists
        app_result = await session.execute(
            sa.select(models.BalancerApplication).where(
                models.BalancerApplication.tournament_id == reg.tournament_id,
                models.BalancerApplication.battle_tag_normalized == bt_normalized,
            )
        )
        application = app_result.scalar_one_or_none()

        if application is None:
            application = models.BalancerApplication(
                tournament_id=reg.tournament_id,
                tournament_sheet_id=sheet.id,
                registration_id=reg.id,
                battle_tag=reg.battle_tag,
                battle_tag_normalized=bt_normalized,
                discord_nick=reg.discord_nick,
                twitch_nick=reg.twitch_nick,
                stream_pov=reg.stream_pov,
                primary_role=reg.primary_role,
                notes=reg.notes,
                is_active=True,
            )
            session.add(application)
            await session.flush()

        # Create BalancerPlayer from application
        player_result = await session.execute(
            sa.select(models.BalancerPlayer).where(
                models.BalancerPlayer.application_id == application.id
            )
        )
        player = player_result.scalar_one_or_none()

        if player is None:
            role_entries = balancer_service.build_role_entries_from_application(application)
            user_id = await balancer_service.resolve_public_user_id_for_application(session, application)

            player = models.BalancerPlayer(
                tournament_id=reg.tournament_id,
                application_id=application.id,
                battle_tag=application.battle_tag,
                battle_tag_normalized=application.battle_tag_normalized,
                user_id=user_id,
                role_entries_json=role_entries,
                is_flex=False,
                is_in_pool=True,
            )
            balancer_service.sync_legacy_player_fields(player)
            session.add(player)

    # Link accounts to player profile
    if reg.user_id and (reg.battle_tag or reg.discord_nick or reg.twitch_nick):
        await _link_accounts_from_registration(session, reg)

    # Link custom field accounts
    if reg.user_id and reg.custom_fields_json:
        await _link_custom_accounts(session, reg)

    await session.commit()

    return ApproveResponse(
        registration_id=reg.id,
        status="approved",
        application_id=application.id if application else None,
        player_id=player.id if player else None,
    )


@router.patch("/registrations/{registration_id}/reject")
async def reject_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    result = await session.execute(
        sa.select(models.BalancerRegistration).where(
            models.BalancerRegistration.id == registration_id
        )
    )
    reg = result.scalar_one_or_none()
    if reg is None:
        raise HTTPException(status_code=404, detail="Registration not found")

    reg.status = "rejected"
    reg.reviewed_at = datetime.now(UTC)
    reg.reviewed_by = user.id
    await session.commit()
    return {"status": "rejected"}


@router.delete("/registrations/{registration_id}")
async def delete_registration(
    registration_id: int,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    result = await session.execute(
        sa.select(models.BalancerRegistration).where(
            models.BalancerRegistration.id == registration_id
        )
    )
    reg = result.scalar_one_or_none()
    if reg is None:
        raise HTTPException(status_code=404, detail="Registration not found")

    await session.delete(reg)
    await session.commit()
    return {"status": "deleted"}


@router.post("/tournaments/{tournament_id}/registrations/bulk-approve", response_model=BulkApproveResponse)
async def bulk_approve_registrations(
    tournament_id: int,
    data: BulkApproveRequest,
    session: AsyncSession = Depends(db.get_async_session),
    user: models.AuthUser = Depends(auth.require_permission("team", "import")),
):
    result = await session.execute(
        sa.select(models.BalancerRegistration).where(
            models.BalancerRegistration.tournament_id == tournament_id,
            models.BalancerRegistration.id.in_(data.registration_ids),
            models.BalancerRegistration.status == "pending",
        )
    )
    registrations = list(result.scalars().all())
    approved = 0
    for reg in registrations:
        reg.status = "approved"
        reg.reviewed_at = datetime.now(UTC)
        reg.reviewed_by = user.id
        approved += 1

    await session.commit()
    return BulkApproveResponse(
        approved=approved,
        skipped=len(data.registration_ids) - approved,
    )


# ---------------------------------------------------------------------------
# Account linking helpers
# ---------------------------------------------------------------------------


async def _link_accounts_from_registration(
    session: AsyncSession,
    reg: models.BalancerRegistration,
) -> None:
    """Link battle_tag, discord, twitch from registration to players.user."""
    if reg.user_id is None:
        return

    if reg.discord_nick:
        existing = await session.execute(
            sa.select(models.UserDiscord).where(
                models.UserDiscord.user_id == reg.user_id,
                models.UserDiscord.name == reg.discord_nick,
            )
        )
        if existing.scalar_one_or_none() is None:
            try:
                session.add(models.UserDiscord(user_id=reg.user_id, name=reg.discord_nick))
                await session.flush()
            except Exception:
                await session.rollback()

    if reg.twitch_nick:
        existing = await session.execute(
            sa.select(models.UserTwitch).where(
                models.UserTwitch.user_id == reg.user_id,
                models.UserTwitch.name == reg.twitch_nick,
            )
        )
        if existing.scalar_one_or_none() is None:
            try:
                session.add(models.UserTwitch(user_id=reg.user_id, name=reg.twitch_nick))
                await session.flush()
            except Exception:
                await session.rollback()


async def _link_custom_accounts(
    session: AsyncSession,
    reg: models.BalancerRegistration,
) -> None:
    """Create external_account entries from custom registration fields."""
    if reg.user_id is None or not reg.custom_fields_json:
        return

    account_suffixes = ("_nick", "_link", "_url", "_account")
    for key, value in reg.custom_fields_json.items():
        if not isinstance(value, str) or not value.strip():
            continue
        if not any(key.endswith(suffix) for suffix in account_suffixes):
            continue

        # Derive provider from key: "boosty_nick" -> "boosty"
        provider = key
        for suffix in account_suffixes:
            if provider.endswith(suffix):
                provider = provider[: -len(suffix)]
                break

        existing = await session.execute(
            sa.select(models.UserExternalAccount).where(
                models.UserExternalAccount.user_id == reg.user_id,
                models.UserExternalAccount.provider == provider,
                models.UserExternalAccount.username == value.strip(),
            )
        )
        if existing.scalar_one_or_none() is None:
            url = value.strip() if key.endswith(("_link", "_url")) else None
            session.add(
                models.UserExternalAccount(
                    user_id=reg.user_id,
                    provider=provider,
                    username=value.strip(),
                    url=url,
                )
            )
