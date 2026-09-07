"""Workspace CRUD via the shared CRUD engine.

Only update + delete go through the engine — both are workspace-scoped
(``workspace.update`` / ``workspace.delete``, resolved from the path id itself).
``create`` is superuser-global with heavy side-effects (slug check, system roles,
owner member, RBAC cache bust) so it stays a bespoke handler in ``src/rpc/workspaces.py``.
Member management is bespoke too.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.crud import CrudDispatcher, EntityConfig
from shared.services.roster_shape_access import invalidate_roster_shape_cache
from shared.services.roster_shape_guards import assert_workspace_roster_shape_unlocked
from src import models, schemas
from src.core import db
from src.services.workspace.service import workspaces as workspace_service


async def _ser_workspace(session: AsyncSession, obj: Any) -> Any:
    return schemas.WorkspaceRead.model_validate(obj, from_attributes=True).model_dump(mode="json")


async def _ws_self(session: AsyncSession, obj_id: int) -> int:
    # The workspace IS the entity, so the owning workspace id is the path id.
    return obj_id


async def _svc_update(
    session: AsyncSession, obj_id: int, payload: schemas.WorkspaceUpdate, data: dict[str, Any]
) -> Any:
    workspace = await workspace_service.get_by_id(session, obj_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    update_data = payload.model_dump(exclude_unset=True)
    # Detected here, before the write, and acted on after the commit: dropping the
    # cache first would let a concurrent read repopulate it from the pre-commit
    # row, and that stale entry would then outlive the write by a full TTL.
    roster_slots_changed = "default_roster_slots_json" in update_data and (
        update_data["default_roster_slots_json"] != workspace.default_roster_slots_json
    )
    # Every tournament without its own override reads this map, so the change has
    # to clear the same bar the per-tournament write does (tournament-service
    # admin update): no draft mid-pick, no team still holding slots. Without it a
    # 1/2/2 draft silently starts validating picks against another shape.
    if roster_slots_changed:
        await assert_workspace_roster_shape_unlocked(session, workspace.id)
    workspace = await workspace_service.update(session, workspace, update_data)
    await session.commit()
    if roster_slots_changed:
        await invalidate_roster_shape_cache(workspace_id=workspace.id)
    return workspace


async def _svc_delete(session: AsyncSession, obj_id: int, data: dict[str, Any]) -> None:
    workspace = await workspace_service.get_by_id(session, obj_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    await workspace_service.delete(session, workspace)
    await session.commit()


REGISTRY: dict[str, EntityConfig] = {
    "workspace": EntityConfig(
        entity="workspace",
        model=models.Workspace,
        permission_resource="workspace",
        serializer=_ser_workspace,
        update_schema=schemas.WorkspaceUpdate,
        resolve_ws_from_id=_ws_self,
        service_update=_svc_update,
        service_delete=_svc_delete,
        not_found_detail="Workspace not found",
        actions=frozenset({"update", "delete"}),
    ),
}

dispatcher = CrudDispatcher(REGISTRY, db.async_session_maker)
