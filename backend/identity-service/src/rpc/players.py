"""Linking site accounts to tournament players.

Transport only: parse the RPC payload, resolve the caller when the method needs
one, hand off to a service object, serialise the result. Every authorization
decision, query and error message belongs to ``src/services/**``.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage
from sqlalchemy.ext.asyncio import AsyncSession

from src import schemas
from src.services.players import players

from . import _common as c

__all__ = ("register",)


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.identity.player.link")
    async def _player_link(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            payload = schemas.PlayerLinkRequest.model_validate(data)
            result = await players.link_and_describe(session, user, payload)
            return result.model_dump(mode="json")

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.player.unlink")
    async def _player_unlink(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> None:
            await players.unlink(session, user, c.require_int(data, "player_id"))

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.player.linked")
    async def _player_linked(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> list[dict]:
            linked = await players.linked_payload(session, user)
            return [player.model_dump(mode="json") for player in linked]

        return await c.with_active_user(logger, data.get("access_token"), op)

    @broker.subscriber("rpc.identity.player.set_primary")
    async def _player_set_primary(data: dict, msg: RabbitMessage) -> dict:
        data = data or {}

        async def op(session: AsyncSession, user: Any) -> dict:
            return await players.confirm_primary(session, user, c.require_int(data, "player_id"))

        return await c.with_active_user(logger, data.get("access_token"), op)
