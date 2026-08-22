"""Read side of the platform audit log (``GET /api/v1/admin/audit``).

Pure transport: decode the query, resolve the one workspace this read is
confined to, hand it to ``services.admin.audit``. The queries themselves —
filters, ordering, page + count — live on ``AuditLogQueries``; the only thing
that stays here is ``_scope``, which is authorization, not SQL.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.auth_user import AuthUser
from shared.rpc.identity import ensure_workspace_permission
from shared.rpc.query import build_query_model
from src.core import db
from src.schemas.admin import audit as audit_schemas
from src.services.admin.audit import audit_log as audit_service

from . import _common as c

_SF = db.async_session_maker


def _scope(user: AuthUser, workspace_id: int | None) -> int | None:
    """Resolve the single workspace this read is confined to.

    ``None`` means "no workspace predicate", and it is reachable only for a
    superuser — for anyone else an absent ``workspace_id`` is a 422, never a
    platform-wide feed. Falling back to "show everything you may see" would have
    to union the caller's workspaces, and the one row class that has no
    workspace at all (global roles, game catalog, global settings) would then
    have to be excluded by a second rule; requiring the parameter keeps the
    predicate a single equality that cannot accidentally widen.
    """
    if user.is_superuser:
        # A superuser may still narrow to one workspace by passing the param;
        # omitting it is what makes the `workspace_id IS NULL` platform rows
        # visible, and nobody else can reach that state.
        return workspace_id
    if workspace_id is None:
        raise HTTPException(status_code=422, detail="workspace_id is required")
    ensure_workspace_permission(user, workspace_id, "audit", "read")
    return workspace_id


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.audit_list")
    async def _audit_list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            qp = build_query_model(audit_schemas.AuditLogListQueryParams, data.get("query"))
            params = audit_schemas.AuditLogListParams.from_query_params(qp)
            return await audit_service.list_page(session, _scope(user, params.workspace_id), params)

        return await c.envelope(logger, "audit_list", op, session_factory=_SF)
