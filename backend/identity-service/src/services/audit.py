"""Audit rows for identity's operator writes."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.services.audit import record_audit


async def record_operator_audit(
    session: AsyncSession,
    actor: models.AuthUser,
    *,
    ip_address: str | None,
    user_agent: str | None,
    **fields: Any,
) -> None:
    """Stage an ``admin``-source audit row for ``actor``; never commits.

    ``actor`` is resolved from the bearer token before any flow runs, so its
    display name is a true snapshot that keeps the row readable after the
    account is deleted.
    """
    await record_audit(
        session,
        source="admin",
        actor=actor,
        actor_label=actor.username or actor.email,
        ip_address=ip_address,
        user_agent=user_agent,
        **fields,
    )
