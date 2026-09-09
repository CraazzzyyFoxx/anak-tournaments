"""Subscription provider-config and workspace-requirement CRUD.

Both tables are written with ``INSERT ... ON CONFLICT DO UPDATE`` against a *named*
constraint, and both reads that follow an upsert must pass ``populate_existing=True``:
the upsert changes the row behind the ORM's back, so a plain SELECT would be served
from the identity map and return the pre-upsert JSON blob.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.repository.base import BaseRepository

PROVIDER_CONFIG_CONSTRAINT = "uq_subscription_config_workspace_provider"
REQUIREMENT_CONSTRAINT = "uq_subscription_requirement_workspace_name"


class SubscriptionProviderConfigRepository(BaseRepository[models.SubscriptionProviderConfig]):
    def __init__(self) -> None:
        super().__init__(models.SubscriptionProviderConfig)

    async def list_for_workspace(
        self, session: AsyncSession, workspace_id: int
    ) -> Sequence[models.SubscriptionProviderConfig]:
        result = await session.execute(
            self.select().where(models.SubscriptionProviderConfig.workspace_id == workspace_id)
        )
        return result.scalars().all()

    async def get_for_provider(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        provider: Any,
        populate_existing: bool = False,
    ) -> models.SubscriptionProviderConfig | None:
        query = self.select().where(
            models.SubscriptionProviderConfig.workspace_id == workspace_id,
            models.SubscriptionProviderConfig.provider == provider,
        )
        if populate_existing:
            query = query.execution_options(populate_existing=True)
        result = await session.execute(query)
        return result.scalars().one_or_none()

    async def upsert(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        provider: Any,
        enabled: bool,
        config_json: dict[str, Any],
    ) -> None:
        statement = pg_insert(models.SubscriptionProviderConfig).values(
            workspace_id=workspace_id,
            provider=provider,
            enabled=enabled,
            config_json=config_json,
        )
        await session.execute(
            statement.on_conflict_do_update(
                constraint=PROVIDER_CONFIG_CONSTRAINT,
                set_={
                    "enabled": statement.excluded.enabled,
                    "config_json": statement.excluded.config_json,
                    "updated_at": sa.func.now(),
                },
            )
        )


class WorkspaceSubscriptionRequirementRepository(BaseRepository[models.WorkspaceSubscriptionRequirement]):
    def __init__(self) -> None:
        super().__init__(models.WorkspaceSubscriptionRequirement)

    async def get_default_blob(self, session: AsyncSession, workspace_id: int) -> dict[str, Any]:
        """The workspace's default rule as a raw blob, or ``{}`` when it has none."""
        requirement = models.WorkspaceSubscriptionRequirement
        blob = await session.scalar(
            sa.select(requirement.requirement_json).where(
                requirement.workspace_id == workspace_id,
                requirement.is_default.is_(True),
            )
        )
        return dict(blob) if blob else {}

    async def upsert_default(
        self,
        session: AsyncSession,
        *,
        workspace_id: int,
        name: str,
        requirement_json: dict[str, Any],
    ) -> None:
        """Replace the workspace's default rule.

        Conflicts on ``(workspace_id, name)`` rather than on the partial "one default
        per workspace" index: the named constraint is the stable target.
        """
        statement = pg_insert(models.WorkspaceSubscriptionRequirement).values(
            workspace_id=workspace_id,
            name=name,
            requirement_json=requirement_json,
            is_default=True,
        )
        await session.execute(
            statement.on_conflict_do_update(
                constraint=REQUIREMENT_CONSTRAINT,
                set_={
                    "requirement_json": statement.excluded.requirement_json,
                    "is_default": statement.excluded.is_default,
                    "updated_at": sa.func.now(),
                },
            )
        )


__all__ = (
    "PROVIDER_CONFIG_CONSTRAINT",
    "REQUIREMENT_CONSTRAINT",
    "SubscriptionProviderConfigRepository",
    "WorkspaceSubscriptionRequirementRepository",
)
