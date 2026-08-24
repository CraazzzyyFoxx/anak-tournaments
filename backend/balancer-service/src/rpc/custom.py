"""Custom games over typed RPC.

``rpc.balancer.custom.{create,list,get,update_roster,set_rank,balance,record_outcome,delete}``.
Writes require ``actor == host``. Reads are any workspace member.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from src.core import db
from src.rpc import _common as c
from src.services.custom_game import custom_game_service

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


def _game_id(data: dict[str, Any]) -> int:
    body = c.payload(data)
    raw = body.get("custom_game_id", data.get("custom_game_id", body.get("id", data.get("id"))))
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="custom_game_id is required") from None


def _require_member(user: Any, workspace_id: int) -> None:
    if not user.is_workspace_member(workspace_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a workspace member")


def _player_ids(data: dict[str, Any]) -> list[int] | None:
    body = c.payload(data)
    raw = body.get("player_ids", data.get("player_ids", body.get("workspace_player_ids", data.get("workspace_player_ids"))))
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="player_ids is required")
    try:
        return [int(item) for item in raw]
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="player_ids is required") from None


def _dump_game(game: Any, roster: list[Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": game.id,
        "workspace_id": game.workspace_id,
        "host_user_id": game.host_user_id,
        "name": game.name,
        "status": game.status,
        "config_json": game.config_json,
        "result_json": game.result_json,
        "outcome_json": game.outcome_json,
    }
    if roster is not None:
        out["players"] = [
            {
                "id": row.id,
                "workspace_player_id": row.workspace_player_id,
                "rank_value": row.rank_value,
                "team_index": row.team_index,
                "sort_order": row.sort_order,
            }
            for row in roster
        ]
    return out


async def _with_roster(session: Any, game: Any) -> dict[str, Any]:
    roster = await custom_game_service.roster.list_for_game(session, game.id)
    return _dump_game(game, list(roster))


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.balancer.custom.create")
    async def _create(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            body = c.payload(data)
            name = body.get("name", data.get("name"))
            if not isinstance(name, str):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="name is required")
            config_json = body.get("config_json", data.get("config_json"))
            if config_json is not None and not isinstance(config_json, dict):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="config_json is required")
            game = await custom_game_service.create(
                session,
                workspace_id=workspace_id,
                host_user_id=_opt_int(data, "host_user_id") or user.id,
                name=name,
                actor_user_id=user.id,
                player_ids=_player_ids(data),
                config_json=config_json,
            )
            await session.commit()
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.create", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            rows = await custom_game_service.list(session, workspace_id=workspace_id)
            return [_dump_game(row) for row in rows]

        return await c.envelope(logger, "custom.list", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.get")
    async def _get(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            game = await custom_game_service.get(session, workspace_id=workspace_id, custom_game_id=_game_id(data))
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.get", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.update_roster")
    async def _update_roster(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            player_ids = _player_ids(data)
            if player_ids is None:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="player_ids is required")
            game = await custom_game_service.update_roster(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                player_ids=player_ids,
                actor_user_id=user.id,
            )
            await session.commit()
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.update_roster", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.set_rank")
    async def _set_rank(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            body = c.payload(data)
            raw_rank = body.get("rank_value", data.get("rank_value"))
            rank_value = None if raw_rank is None else int(raw_rank)
            row = await custom_game_service.set_rank(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                workspace_player_id=_int(data, "workspace_player_id"),
                rank_value=rank_value,
                actor_user_id=user.id,
            )
            await session.commit()
            return {
                "id": row.id,
                "workspace_player_id": row.workspace_player_id,
                "rank_value": row.rank_value,
                "team_index": row.team_index,
                "sort_order": row.sort_order,
            }

        return await c.envelope(logger, "custom.set_rank", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.balance")
    async def _balance(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            game = await custom_game_service.balance(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                actor_user_id=user.id,
            )
            await session.commit()
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.balance", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.record_outcome")
    async def _record_outcome(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            body = c.payload(data)
            outcome = body.get("outcome_json", data.get("outcome_json", body.get("outcome", data.get("outcome"))))
            if not isinstance(outcome, dict):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="outcome_json is required")
            game = await custom_game_service.record_outcome(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                outcome_json=outcome,
                actor_user_id=user.id,
            )
            await session.commit()
            return await _with_roster(session, game)

        return await c.envelope(logger, "custom.record_outcome", op, session_factory=_SF)

    @broker.subscriber("rpc.balancer.custom.delete")
    async def _delete(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            user = c.active_actor(data)
            workspace_id = _int(data, "workspace_id")
            _require_member(user, workspace_id)
            game = await custom_game_service.cancel(
                session,
                workspace_id=workspace_id,
                custom_game_id=_game_id(data),
                actor_user_id=user.id,
            )
            await session.commit()
            return _dump_game(game)

        return await c.envelope(logger, "custom.delete", op, session_factory=_SF)
