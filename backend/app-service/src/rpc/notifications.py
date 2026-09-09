"""Typed-RPC subscribers for the notification inbox and announcement banner.

Three queues, one service module underneath. The only thing decided here is
*who is asking*: ``notifications_list``/``notifications_mark_read`` take the
identity from the gateway envelope and refuse to run without it, while
``active_announcements`` is the ``AuthOptional`` banner read whose anonymous
response the gateway caches for every visitor.

No handler ever reads a caller-supplied user or workspace id: the audience is
computed from ``c.actor(data).id`` alone (Global Constraint 3).
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.repository.notification import DEFAULT_PAGE_LIMIT
from src import schemas
from src.core import db
from src.rpc import _common as c
from src.services import notifications as notification_service

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.notifications_list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            return await notification_service.inbox_page(
                session,
                auth_user_id=user.id,
                cursor=c.q1(data, "cursor"),
                limit=c.q1(data, "limit", int, DEFAULT_PAGE_LIMIT),
            )

        return await c.envelope(logger, "notifications.list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.notifications_mark_read")
    async def _mark_read(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            body = schemas.NotificationMarkRead.model_validate(c.payload(data))
            return await notification_service.mark_read(
                session,
                auth_user_id=user.id,
                notification_ids=body.ids,
            )

        return await c.envelope(logger, "notifications.mark_read", op, session_factory=_SF)

    @broker.subscriber("rpc.app.notifications_delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.actor(data)
            c.require_active(user)
            body = schemas.NotificationDelete.model_validate(c.payload(data))
            return await notification_service.delete(
                session,
                auth_user_id=user.id,
                notification_ids=body.ids,
                only_read=body.only_read,
            )

        return await c.envelope(logger, "notifications.delete", op, session_factory=_SF)

    @broker.subscriber("rpc.app.active_announcements")
    async def _active_announcements(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            viewer = c.optional_actor(data)
            return await notification_service.active_announcements(
                session,
                auth_user_id=viewer.id if viewer is not None else None,
            )

        return await c.envelope(logger, "notifications.active_announcements", op, session_factory=_SF)
