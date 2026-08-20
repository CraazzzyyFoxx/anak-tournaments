"""Bespoke map reads (lookup). get/list go through the shared read engine."""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from src.core import db
from src.rpc import _common as c
from src.services.map.flows import maps as map_service

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.maps.lookup")
    async def _lookup(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await map_service.lookup(session)

        return await c.envelope(logger, "maps.lookup", op, session_factory=_SF)
