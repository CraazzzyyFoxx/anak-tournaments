"""Typed-RPC subscribers for the workspace-scoped notification operator screen.

Transport plus one decision: *which tenant is this operator acting inside*. The
scope is always an explicit ``workspace_id`` checked against
``notification.<action>`` in that workspace -- there is no platform-wide mode
here, unlike announcements. A superuser reaching every tenant's produced rows
through one unscoped list would be a cross-tenant read with no workspace to
audit it against, and the per-workspace call already serves them wherever they
hold the grant.

Announcements are deliberately unreachable through these subjects: they have
their own CRUD, their own locale rules and their own permission. See
``services/notification_admin.py`` for why a "delete" here is a retire.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.rpc.identity import ensure_workspace_permission
from src import schemas
from src.core import db
from src.rpc import _common as c
from src.services import notification_admin as admin_service

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.notification_admin_list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            workspace_id = c.require_query_int(data, "workspace_id")
            ensure_workspace_permission(user, workspace_id, "notification", "read")
            return await admin_service.list_for_workspace(
                session,
                workspace_id=workspace_id,
                kind=c.q1(data, "kind"),
                cursor=c.q1(data, "cursor"),
                limit=c.q1(data, "limit", int, admin_service.DEFAULT_LIST_LIMIT),
            )

        return await c.envelope(logger, "notification_admin.list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.notification_admin_retire")
    async def _retire(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            body = schemas.NotificationRetire.model_validate(c.payload(data))
            ensure_workspace_permission(user, body.workspace_id, "notification", "delete")
            return await admin_service.retire(
                session,
                actor=user,
                data=data,
                workspace_id=body.workspace_id,
                ids=body.ids,
                kind=body.kind,
            )

        return await c.envelope(logger, "notification_admin.retire", op, session_factory=_SF)
