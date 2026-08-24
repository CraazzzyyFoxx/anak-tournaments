"""Workspace players over typed RPC.

``rpc.balancer.players.{list, upsert, set_ranks}``.
Reads and writes require workspace membership. ``set_ranks`` writes CANON.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared import models
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from src.core import db
from src.rpc import _common as c
from src.services.workspace_player import workspace_player_service

_SF = db.async_session_maker


def _require_member(user: Any, workspace_id: int) -> None:
    if not user.is_workspace_member(workspace_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a workspace member")


def _ranks_payload(data: dict[str, Any]) -> dict[str, int]:
    body = c.payload(data)
    ranks = body.get("ranks", data.get("ranks")) or {}
    if not isinstance(ranks, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ranks is required")
    try:
        return {str(role): int(value) for role, value in ranks.items()}
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ranks is required") from exc


def _player_id(data: dict[str, Any]) -> int:
    body = c.payload(data)
    raw = body.get(
        "workspace_player_id",
        data.get("workspace_player_id", body.get("player_id", data.get("player_id", data.get("id")))),
    )
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="workspace_player_id is required"
        ) from None


def _dump(row: Any, ranks: dict[str, int]) -> dict[str, Any]:
    return {
        "id": row.id,
        "workspace_id": row.workspace_id,
        "battle_tag": row.battle_tag,
        "display_name": row.display_name,
        "player_id": row.player_id,
        "ranks": ranks,
    }


async def _load_visible(session: Any, workspace_id: int, workspace_player_id: int) -> models.WorkspacePlayer:
    player = await workspace_player_service.players.get(session, workspace_player_id)
    if player is None or player.workspace_id != workspace_id or player.hidden_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace player not found")
    return player


async def _ranks_for(session: Any, player_ids: list[int]) -> dict[int, dict[str, int]]:
    out: dict[int, dict[str, int]] = {player_id: {} for player_id in player_ids}
    for row in await workspace_player_service.ranks.list_ranks_for_players(session, player_ids):
        out.setdefault(row.workspace_player_id, {})[row.role] = row.rank_value
    return out


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.balancer.players.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = c.path_int(data, "workspace_id")
            _require_member(user, workspace_id)
            rows, _total = await workspace_player_service.players.list(
                session,
                filters=[
                    models.WorkspacePlayer.workspace_id == workspace_id,
                    models.WorkspacePlayer.hidden_at.is_(None),
                ],
                order_by=[models.WorkspacePlayer.id.asc()],
            )
            ranks = await _ranks_for(session, [row.id for row in rows])
            return [_dump(row, ranks.get(row.id, {})) for row in rows]

        return await c.envelope(logger, "players.list", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.players.upsert")
    async def _upsert(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = c.path_int(data, "workspace_id")
            _require_member(user, workspace_id)
            body = c.payload(data)
            battle_tag = body.get("battle_tag", data.get("battle_tag"))
            if not isinstance(battle_tag, str) or not battle_tag.strip():
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="battle_tag is required")
            display_name = body.get("display_name", data.get("display_name"))
            if isinstance(display_name, str):
                display_name = display_name.strip() or None
            elif display_name is not None:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="display_name is required")
            row = await workspace_player_service.upsert(
                session,
                workspace_id=workspace_id,
                battle_tag=battle_tag,
                display_name=display_name,
            )
            await session.commit()
            ranks = await _ranks_for(session, [row.id])
            return _dump(row, ranks.get(row.id, {}))

        return await c.envelope(logger, "players.upsert", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.players.set_ranks")
    async def _set_ranks(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = c.path_int(data, "workspace_id")
            _require_member(user, workspace_id)
            player = await _load_visible(session, workspace_id, _player_id(data))
            ranks = await workspace_player_service.set_ranks(
                session,
                workspace_player_id=player.id,
                ranks=_ranks_payload(data),
            )
            await session.commit()
            return ranks

        return await c.envelope(logger, "players.set_ranks", op, session_factory=_SF)
