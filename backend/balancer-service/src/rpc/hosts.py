"""Host pool and rank book over typed RPC.

``rpc.balancer.hosts.{list_pool, add, remove, set_ranks, get_book}``.
Writes require ``actor == host_user_id``. Reads are any workspace member.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.services.host_book import host_book_service
from src.core import db
from src.rpc import _common as c

_SF = db.async_session_maker


def _int(data: dict[str, Any], key: str) -> int:
    body = c.payload(data)
    raw = body.get(key, data.get(key))
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} is required") from None


def _opt_int(data: dict[str, Any], key: str) -> int | None:
    body = c.payload(data)
    raw = body.get(key, data.get(key))
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{key} is required") from None


def _require_member(user: Any, workspace_id: int) -> None:
    if not user.is_workspace_member(workspace_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a workspace member")


def _membership(row: Any) -> dict[str, int]:
    return {
        "id": row.id,
        "workspace_id": row.workspace_id,
        "host_user_id": row.host_user_id,
        "workspace_player_id": row.workspace_player_id,
    }


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.balancer.hosts.list_pool")
    async def _list_pool(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            host_user_id = _opt_int(data, "host_user_id") or user.id
            rows = await host_book_service.list_pool(session, workspace_id=workspace_id, host_user_id=host_user_id)
            return [_membership(row) for row in rows]

        return await c.envelope(logger, "hosts.list_pool", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.hosts.add")
    async def _add(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            host_user_id = _opt_int(data, "host_user_id") or user.id
            row = await host_book_service.add(
                session,
                workspace_id=workspace_id,
                host_user_id=host_user_id,
                workspace_player_id=_int(data, "workspace_player_id"),
                actor_user_id=user.id,
            )
            await session.commit()
            return _membership(row)

        return await c.envelope(logger, "hosts.add", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.hosts.remove")
    async def _remove(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            host_user_id = _opt_int(data, "host_user_id") or user.id
            await host_book_service.remove(
                session,
                workspace_id=workspace_id,
                host_user_id=host_user_id,
                workspace_player_id=_int(data, "workspace_player_id"),
                actor_user_id=user.id,
            )
            await session.commit()
            return {"ok": True}

        return await c.envelope(logger, "hosts.remove", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.hosts.set_ranks")
    async def _set_ranks(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            host_user_id = _opt_int(data, "host_user_id") or user.id
            body = c.payload(data)
            ranks = body.get("ranks", data.get("ranks")) or {}
            if not isinstance(ranks, dict):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ranks is required")
            ranks_out = await host_book_service.set_ranks(
                session,
                host_user_id=host_user_id,
                workspace_player_id=_int(data, "workspace_player_id"),
                ranks={str(role): int(value) for role, value in ranks.items()},
                actor_user_id=user.id,
            )
            await session.commit()
            return ranks_out

        return await c.envelope(logger, "hosts.set_ranks", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.hosts.get_book")
    async def _get_book(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            host_user_id = _opt_int(data, "host_user_id") or user.id
            workspace_player_id = _int(data, "workspace_player_id")
            ranks = await host_book_service.get_book(
                session, host_user_id=host_user_id, workspace_player_id=workspace_player_id
            )
            return {"host_user_id": host_user_id, "workspace_player_id": workspace_player_id, "ranks": ranks}

        return await c.envelope(logger, "hosts.get_book", op, session_factory=_SF)
