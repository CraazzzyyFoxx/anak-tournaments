"""Registration service — database operations."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models


def _normalize_battle_tag(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    text = re.sub(r"\s*#\s*", "#", text)
    return text.replace(" ", "").strip().lower()


async def get_registration_form(
    session: AsyncSession,
    tournament_id: int,
) -> models.BalancerRegistrationForm | None:
    result = await session.execute(
        sa.select(models.BalancerRegistrationForm).where(
            models.BalancerRegistrationForm.tournament_id == tournament_id
        )
    )
    return result.scalar_one_or_none()


async def get_registration(
    session: AsyncSession,
    tournament_id: int,
    auth_user_id: int,
) -> models.BalancerRegistration | None:
    result = await session.execute(
        sa.select(models.BalancerRegistration)
        .where(
            models.BalancerRegistration.tournament_id == tournament_id,
            models.BalancerRegistration.auth_user_id == auth_user_id,
        )
        .options(selectinload(models.BalancerRegistration.roles))
    )
    return result.scalar_one_or_none()


async def create_registration(
    session: AsyncSession,
    *,
    tournament_id: int,
    workspace_id: int,
    auth_user_id: int,
    user_id: int | None,
    battle_tag: str | None,
    smurf_tags: list[str] | None,
    discord_nick: str | None,
    twitch_nick: str | None,
    stream_pov: bool,
    notes: str | None,
    custom_fields: dict[str, Any] | None,
    auto_approve: bool = False,
) -> models.BalancerRegistration:
    registration = models.BalancerRegistration(
        tournament_id=tournament_id,
        workspace_id=workspace_id,
        auth_user_id=auth_user_id,
        user_id=user_id,
        battle_tag=battle_tag,
        battle_tag_normalized=_normalize_battle_tag(battle_tag),
        smurf_tags_json=smurf_tags,
        discord_nick=discord_nick,
        twitch_nick=twitch_nick,
        stream_pov=stream_pov,
        notes=notes,
        custom_fields_json=custom_fields,
        status="approved" if auto_approve else "pending",
        submitted_at=datetime.now(UTC),
        reviewed_at=datetime.now(UTC) if auto_approve else None,
    )
    session.add(registration)
    await session.commit()
    await session.refresh(registration)
    return registration


async def update_registration(
    session: AsyncSession,
    registration: models.BalancerRegistration,
    **kwargs: Any,
) -> models.BalancerRegistration:
    for key, value in kwargs.items():
        if value is not None:
            setattr(registration, key, value)
    if "battle_tag" in kwargs and kwargs["battle_tag"] is not None:
        registration.battle_tag_normalized = _normalize_battle_tag(kwargs["battle_tag"])
    await session.commit()
    await session.refresh(registration)
    return registration


async def get_registration_count_by_tournament(
    session: AsyncSession,
    tournament_id: int,
) -> int:
    result = await session.execute(
        sa.select(sa.func.count()).where(
            models.BalancerRegistration.tournament_id == tournament_id,
            models.BalancerRegistration.status != "withdrawn",
        )
    )
    return result.scalar_one()


async def withdraw_registration(
    session: AsyncSession,
    registration: models.BalancerRegistration,
) -> None:
    await session.delete(registration)
    await session.commit()
