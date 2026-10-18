"""Admin CRUD for the game catalog (``catalog.entity``): one surface for every discipline and kind (D85).

Superuser-only for every mutation and for the platform-wide list — the catalog is global game content. The one read
open to workspace organizers is ``rpc.app.catalog.workspace_characters``. Pure transport: gate, decode, one service
call. The discipline and kind arrive as path parameters (``/api/v1/admin/catalog/{discipline}/{kind}``).
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from shared.core.pagination import paginated_dump
from shared.repository import WorkspaceRepository
from shared.rpc.query import build_query_model
from shared.services.audit import record_admin_audit
from shared.services.ontology import assert_discipline_enabled
from src import schemas
from src.core import db
from src.services.admin.catalog import catalog as catalog_service
from src.services.admin.catalog import to_read

from . import _common as c

_SF = db.async_session_maker
_AUDIT_TYPE = "catalog_entity"


def _gate(data: dict) -> None:
    c.require_superuser(c.actor(data))


def _path(data: dict) -> tuple[str, str]:
    return str(data.get("discipline") or ""), str(data.get("kind") or "")


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.catalog.admin_list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            qp = build_query_model(schemas.CatalogEntityListQueryParams, data.get("query"))
            params = schemas.CatalogEntityListParams.from_query_params(qp)
            return paginated_dump(await catalog_service.list(session, discipline, kind, params))

        return await c.envelope(logger, "catalog.admin_list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.workspace_characters")
    async def _workspace_characters(data: dict, msg: RabbitMessage) -> dict:
        """Read-only: one discipline's characters for a workspace's achievement editor.

        Authorized by the workspace's achievement permission (create or update), not by superuser: an organizer who may
        link a rule to a character must be able to pick one. Only this read is opened; every catalog mutation above
        stays superuser-only.
        """

        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            workspace_id = int(data.get("workspace_id") or 0)
            if not (
                user.has_workspace_permission(workspace_id, "achievement", "create")
                or user.has_workspace_permission(workspace_id, "achievement", "update")
            ):
                raise HTTPException(
                    status_code=403,
                    detail=f"Permission denied for workspace {workspace_id}: achievement.update required",
                )
            discipline, _ = _path(data)
            # Only after the permission check (a caller sees nothing of a workspace it may not edit): the workspace
            # must exist and run the game, so a read can never expose a catalogue the workspace does not use.
            workspace = await WorkspaceRepository().get(session, workspace_id)
            if workspace is None:
                raise HTTPException(status_code=404, detail="Workspace not found")
            assert_discipline_enabled(workspace, discipline)
            qp = build_query_model(schemas.CatalogEntityListQueryParams, data.get("query"))
            params = schemas.CatalogEntityListParams.from_query_params(qp)
            return paginated_dump(await catalog_service.list(session, discipline, "character", params))

        return await c.envelope(logger, "catalog.workspace_characters", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.admin_create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            body = schemas.CatalogEntityCreate.model_validate(c.payload(data))
            await record_admin_audit(
                session,
                action=f"{_AUDIT_TYPE}.create",
                actor=c.actor(data),
                data=data,
                workspace_id=None,
                entity_type=_AUDIT_TYPE,
                entity_label=body.name,
                after={"discipline": discipline, "kind": kind, "name": body.name, "slug": body.slug},
            )
            return to_read(await catalog_service.create(session, discipline, kind, body))

        return await c.envelope(logger, "catalog.admin_create", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.admin_update")
    async def _update(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            entity_id = c.require_id(data)
            body = schemas.CatalogEntityUpdate.model_validate(c.payload(data))
            await record_admin_audit(
                session,
                action=f"{_AUDIT_TYPE}.update",
                actor=c.actor(data),
                data=data,
                workspace_id=None,
                entity_type=_AUDIT_TYPE,
                entity_id=entity_id,
                after=body.model_dump(exclude_unset=True),
            )
            return to_read(await catalog_service.update(session, discipline, kind, entity_id, body))

        return await c.envelope(logger, "catalog.admin_update", op, session_factory=_SF)

    @broker.subscriber("rpc.app.catalog.admin_delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            _gate(data)
            discipline, kind = _path(data)
            entity_id = c.require_id(data)
            await record_admin_audit(
                session,
                action=f"{_AUDIT_TYPE}.delete",
                actor=c.actor(data),
                data=data,
                workspace_id=None,
                entity_type=_AUDIT_TYPE,
                entity_id=entity_id,
            )
            await catalog_service.delete(session, discipline, kind, entity_id)
            return None

        return await c.envelope(logger, "catalog.admin_delete", op, session_factory=_SF)
