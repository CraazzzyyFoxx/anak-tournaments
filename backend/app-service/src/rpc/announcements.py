"""Typed-RPC subscribers for the operator-facing announcement CRUD.

Transport plus one decision: *who may publish what to whom*. It splits in two,
and the split is the whole security model of the feature.

A workspace announcement is a tenant-scoped write, authorized by
``announcement.<action>`` inside that workspace. A **global** one renders as a
banner to every visitor of the platform, anonymous ones included, so it is gated
on the platform principal instead -- a workspace owner holding
``announcement.create`` cannot reach it. Making the global audience just another
grant would let any owner speak in the platform's voice.

``audience='user'`` is not reachable here at all: personal notifications are
written by the domain flows that cause them, from server-resolved recipients
(Global Constraint 3). The request schema simply has no such value.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.models.identity.auth_user import AuthUser
from shared.rpc.identity import ensure_workspace_permission
from src import schemas
from src.core import db
from src.services import announcements as announcement_service

from . import _common as c

_SF = db.async_session_maker


def _authorize(user: AuthUser, audience: str, workspace_id: int | None, action: str) -> None:
    """The audience decides which principal is required -- see the module docstring."""
    if audience == "global":
        c.require_superuser(user)
        return
    c.require_active(user)
    ensure_workspace_permission(user, int(workspace_id), "announcement", action)


def _scope(user: AuthUser, workspace_id: int | None) -> int | None:
    """Resolve the single scope an operator list is confined to.

    ``None`` means the platform-wide feed, and it is reachable only for a
    superuser: the same rule as the writes, so the list cannot become a way to
    read announcements one may not publish.
    """
    if workspace_id is None:
        c.require_superuser(user)
        return None
    c.require_active(user)
    ensure_workspace_permission(user, workspace_id, "announcement", "read")
    return workspace_id


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.announcement_list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            return await announcement_service.list_for_scope(
                session,
                workspace_id=_scope(user, c.q1(data, "workspace_id", int)),
                limit=c.q1(data, "limit", int, announcement_service.DEFAULT_LIST_LIMIT),
            )

        return await c.envelope(logger, "announcement.list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.announcement_create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            body = schemas.AnnouncementCreate.model_validate(c.payload(data))
            _authorize(user, body.audience, body.workspace_id, "create")
            return await announcement_service.create(session, actor=user, data=data, body=body)

        return await c.envelope(logger, "announcement.create", op, session_factory=_SF)

    @broker.subscriber("rpc.app.announcement_update")
    async def _update(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            # The row is loaded before the check: its stored audience decides
            # which principal is required, never a value from the request.
            row = await announcement_service.get(session, c.require_id(data))
            _authorize(user, row.audience, row.workspace_id, "update")
            body = schemas.AnnouncementUpdate.model_validate(c.payload(data))
            return await announcement_service.update(session, actor=user, data=data, row=row, body=body)

        return await c.envelope(logger, "announcement.update", op, session_factory=_SF)

    @broker.subscriber("rpc.app.announcement_delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            row = await announcement_service.get(session, c.require_id(data))
            _authorize(user, row.audience, row.workspace_id, "delete")
            return await announcement_service.retire(session, actor=user, data=data, row=row)

        return await c.envelope(logger, "announcement.delete", op, session_factory=_SF)
