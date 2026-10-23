"""Admin subscribers (``rpc.stream.repoll``, ``rpc.stream.health``, ``rpc.stream.ticks``).

``repoll`` serves ``POST /api/streams/tournament/{tournament_id}/repoll``; ``health``
serves ``GET /api/streams/health`` and ``ticks`` ``GET /api/streams/health/ticks``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.rpc.identity import ensure_workspace_permission
from src.core import db
from src.core.clients import realtime_redis
from src.schemas.stream import StreamPollHealthRead, StreamPollTickRead, StreamRepollRead
from src.services.admin import stream_admin_service

from . import _common as c

__all__ = ("health", "register", "repoll", "ticks")


def _require_global_read(data: dict[str, Any]) -> None:
    user = c.actor(data)
    c.require_active(user)
    # Deliberately NOT ensure_workspace_permission: there is one poller for the
    # whole platform, so a workspace-scoped grant would read numbers that are not
    # about its workspace. Only a global holder (or a superuser) sees this.
    if not user.has_permission("stream", "read"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied: stream.read required")


async def health(session: Any, data: dict[str, Any]) -> StreamPollHealthRead:
    _require_global_read(data)
    return await stream_admin_service.health(session, realtime_redis)


async def ticks(session: Any, data: dict[str, Any]) -> list[StreamPollTickRead]:
    _require_global_read(data)
    return await stream_admin_service.ticks(realtime_redis)


async def repoll(session: Any, data: dict[str, Any]) -> StreamRepollRead:
    tournament_id = c.require_path_int(data, "tournament_id")
    workspace_id = c.require_query_int(data, "workspace_id")
    user = c.actor(data)
    c.require_active(user)
    ensure_workspace_permission(user, workspace_id, "stream", "update")
    return await stream_admin_service.repoll(
        session,
        realtime_redis,
        user,
        tournament_id=tournament_id,
        workspace_id=workspace_id,
        # Put on the envelope's top level by the gateway, not inside `payload`.
        ip_address=data.get("ip_address"),
        user_agent=data.get("user_agent"),
    )


def register(broker: Any, logger: Any) -> None:
    sf = db.async_session_maker

    @broker.subscriber("rpc.stream.repoll")
    async def _repoll(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await repoll(session, data)

        return await c.envelope(logger, "repoll", op, session_factory=sf)

    @broker.subscriber("rpc.stream.health")
    async def _health(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await health(session, data)

        return await c.envelope(logger, "health", op, session_factory=sf)

    @broker.subscriber("rpc.stream.ticks")
    async def _ticks(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await ticks(session, data)

        return await c.envelope(logger, "ticks", op, session_factory=sf)
