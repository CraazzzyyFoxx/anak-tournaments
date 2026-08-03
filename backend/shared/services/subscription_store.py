"""SQLAlchemy implementation of ``EntitlementStore``.

Kept separate from ``subscription_entitlements`` so the resolver's decision table
stays importable and testable without a database.

Every read is a single statement covering all requested providers -- the resolver
promises the DB read does not fan out per provider, which is what keeps a list
view of hundreds of registrants cheap.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.services.subscription_entitlements import ProviderConfigRow, StoredEntitlement
from shared.subscriptions import SubscriptionVerdict

__all__ = ("SqlEntitlementStore",)


class SqlEntitlementStore:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def load_configs(self, workspace_id: int, providers: Sequence[str]) -> dict[str, ProviderConfigRow]:
        if not providers:
            return {}
        rows = await self._session.execute(
            sa.select(
                models.SubscriptionProviderConfig.provider,
                models.SubscriptionProviderConfig.enabled,
                models.SubscriptionProviderConfig.config_json,
            ).where(
                models.SubscriptionProviderConfig.workspace_id == workspace_id,
                models.SubscriptionProviderConfig.provider.in_(list(providers)),
            )
        )
        return {
            provider: ProviderConfigRow(provider=provider, enabled=bool(enabled), config=dict(config or {}))
            for provider, enabled, config in rows.all()
        }

    async def load_entitlements(
        self,
        workspace_id: int,
        auth_user_ids: Sequence[int],
        providers: Sequence[str],
    ) -> dict[tuple[int, str], StoredEntitlement]:
        if not auth_user_ids or not providers:
            return {}
        entitlement = models.SubscriptionEntitlement
        rows = await self._session.execute(
            sa.select(
                entitlement.auth_user_id,
                entitlement.provider,
                entitlement.state,
                entitlement.tier_rank,
                entitlement.tier_label,
                entitlement.source,
                entitlement.checked_at,
                entitlement.expires_at,
                entitlement.evidence_json,
            ).where(
                entitlement.workspace_id == workspace_id,
                entitlement.auth_user_id.in_(list(auth_user_ids)),
                entitlement.provider.in_(list(providers)),
            )
        )
        return {
            (auth_user_id, provider): StoredEntitlement(
                state=state,
                tier_rank=tier_rank,
                tier_label=tier_label,
                source=source,
                checked_at=checked_at,
                expires_at=expires_at,
                evidence=dict(evidence or {}),
            )
            for (
                auth_user_id,
                provider,
                state,
                tier_rank,
                tier_label,
                source,
                checked_at,
                expires_at,
                evidence,
            ) in rows.all()
        }

    async def upsert(
        self,
        workspace_id: int,
        auth_user_id: int,
        provider: str,
        verdict: SubscriptionVerdict,
    ) -> None:
        values: dict[str, Any] = {
            "workspace_id": workspace_id,
            "auth_user_id": auth_user_id,
            "provider": provider,
            "state": verdict.state,
            "tier_rank": verdict.tier_rank,
            "tier_label": verdict.tier_label,
            "source": verdict.source,
            "checked_at": verdict.checked_at,
            "expires_at": verdict.expires_at,
            "evidence_json": verdict.evidence or {},
        }
        stmt = pg_insert(models.SubscriptionEntitlement).values(**values)
        await self._session.execute(
            stmt.on_conflict_do_update(
                constraint="uq_subscription_entitlement_scope",
                set_={
                    "state": stmt.excluded.state,
                    "tier_rank": stmt.excluded.tier_rank,
                    "tier_label": stmt.excluded.tier_label,
                    "source": stmt.excluded.source,
                    "checked_at": stmt.excluded.checked_at,
                    "expires_at": stmt.excluded.expires_at,
                    "evidence_json": stmt.excluded.evidence_json,
                    "updated_at": sa.func.now(),
                },
            )
        )
