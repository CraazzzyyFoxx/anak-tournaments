"""Linking site accounts to tournament players."""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage

from src import schemas
from src.services.players import players

from . import _common as c

__all__ = ("register",)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.identity.player.link")
    async def _player_link(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: Any, user: Any) -> dict:
            payload = schemas.PlayerLinkRequest.model_validate(data)
            result = await players.link_and_describe(session, user, payload)
            return result.model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.player.unlink")
    async def _player_unlink(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: Any, user: Any) -> None:
            await players.unlink(session, user, c.require_int(data, "player_id"))

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.player.linked")
    async def _player_linked(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: Any, user: Any) -> list[dict]:
            linked = await players.linked_payload(session, user)
            return [player.model_dump(mode="json") for player in linked]

        return await c.with_active_user(logger, data.get("access_token"), op)
