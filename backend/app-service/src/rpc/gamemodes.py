"""Bespoke gamemode reads (lookup). get/list go through the shared read engine."""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from src.core import db
from src.rpc import _common as c
from src.services.gamemode.flows import gamemodes as gamemode_service

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.gamemodes.lookup")
    async def _lookup(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await gamemode_service.lookup(session)

        return await c.envelope(logger, "gamemodes.lookup", op, session_factory=_SF)
