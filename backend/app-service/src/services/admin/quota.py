"""Quota policy writes: the superuser plan/operation catalogue and one workspace's override.

``shared.quota.admin`` owns the SQL and the authority rule; each write here stages
its audit row, commits, then drops this worker's policy cache so it stops serving
the ceiling it just replaced. Other replicas fall back to their own cache TTL.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared import models, quota
from shared.quota import admin as quota_admin
from shared.repository import QuotaWorkspaceLimitRepository
from shared.schemas.quota import QuotaOperationWrite, QuotaPlanLimitRead, QuotaPlanWrite
from shared.services.audit import record_admin_audit
from src import schemas

__all__ = ("QuotaAdminService", "quota_admin_service")


def _plan_snapshot(title: str, description: str | None, limits: list[Any]) -> dict[str, Any]:
    """What the journal keeps of a plan: the numbers, not the row identity."""
    return {
        "title": title,
        "description": description,
        "limits": [
            QuotaPlanLimitRead.model_validate(row, from_attributes=True).model_dump(mode="json") for row in limits
        ],
    }


def _override_snapshot(row: Any, scope: str) -> dict[str, Any] | None:
    """One override row as plain numbers, ``None`` when there is no row.

    The two states the journal has to tell apart: "this workspace runs on its
    plan" is what a deleted override restores, and five explicit nulls would
    read as the same thing while meaning something else.
    """
    if row is None:
        return None
    return {"scope": scope, **{name: getattr(row, name) for name in quota_admin.DIMENSIONS}}


class QuotaAdminService:
    def __init__(self, *, workspace_limits: QuotaWorkspaceLimitRepository = QuotaWorkspaceLimitRepository()) -> None:
        self.workspace_limits = workspace_limits

    async def _commit_policy_change(self, session: AsyncSession, **audit: Any) -> None:
        await record_admin_audit(session, **audit)
        await session.commit()
        quota.invalidate_policy()

    async def upsert_plan(self, session: AsyncSession, *, actor: Any, data: dict, body: QuotaPlanWrite) -> Any:
        existing = next(
            ((plan, limits) for plan, limits in await quota_admin.load_plans(session) if plan.slug == body.slug),
            None,
        )
        before = _plan_snapshot(existing[0].title, existing[0].description, existing[1]) if existing else None
        plan = await quota_admin.upsert_plan(
            session,
            slug=body.slug,
            title=body.title,
            description=body.description,
            limits=[row.model_dump() for row in body.limits],
        )
        await self._commit_policy_change(
            session,
            action="quota.plan_upsert",
            actor=actor,
            data=data,
            workspace_id=None,
            entity_type="quota_plan",
            entity_id=plan.id,
            entity_label=body.slug,
            before=before,
            after=_plan_snapshot(body.title, body.description, body.limits),
        )
        return plan

    async def upsert_operation(
        self, session: AsyncSession, *, actor: Any, data: dict, body: QuotaOperationWrite
    ) -> Any:
        existing = next((row for row in await quota_admin.load_operations(session) if row.slug == body.slug), None)
        before = (
            {"cost": existing.cost, "enabled": existing.enabled, "description": existing.description}
            if existing
            else None
        )
        row = await quota_admin.upsert_operation(
            session,
            slug=body.slug,
            cost=body.cost,
            enabled=body.enabled,
            description=body.description,
        )
        await self._commit_policy_change(
            session,
            action="quota.operation_upsert",
            actor=actor,
            data=data,
            workspace_id=None,
            entity_type="quota_operation",
            entity_id=row.id,
            entity_label=body.slug,
            before=before,
            after={"cost": body.cost, "enabled": body.enabled, "description": body.description},
        )
        return row

    async def set_workspace_limits(
        self,
        session: AsyncSession,
        workspace: models.Workspace,
        *,
        actor: Any,
        data: dict,
        body: schemas.WorkspaceQuotaSet,
    ) -> QuotaPlanLimitRead:
        """Write one scope's override and answer the EFFECTIVE ceiling (plan merged with the row)."""
        before = await self.workspace_limits.get_for(session, workspace_id=workspace.id, scope=body.scope)
        before_snapshot = _override_snapshot(before, body.scope)
        row = await quota_admin.apply_workspace_limits(
            session,
            workspace_id=workspace.id,
            scope=body.scope,
            values=body.limits.as_dict(),
            updated_by=actor.id,
            allow_raise=actor.is_superuser,
        )
        await self._commit_policy_change(
            session,
            action="workspace.quota_update",
            actor=actor,
            data=data,
            workspace_id=workspace.id,
            entity_type="workspace",
            entity_id=workspace.id,
            entity_label=workspace.name,
            before=before_snapshot,
            after=_override_snapshot(row, body.scope),
        )
        effective = await quota_admin.inherited_limits(session, workspace_id=workspace.id, scope=body.scope)
        return QuotaPlanLimitRead(scope=body.scope, **effective)


quota_admin_service = QuotaAdminService()
