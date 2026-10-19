"""Public discipline metadata: the installed descriptors and one discipline's scoped native metadata.

Both subjects are ``AuthOptional`` at the gateway: an anonymous request carries no ``identity`` key, an authenticated
one lets a hidden workspace's own members read its child ontology.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from src.core import db
from src.services import discipline as discipline_service

from . import _common as c

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.disciplines.list")
    async def _list(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await discipline_service.list_disciplines(
                session, c.q1(data, "workspace_id"), c.optional_actor(data)
            )

        return await c.envelope(logger, "disciplines.list", op, session_factory=_SF)

    @broker.subscriber("rpc.app.disciplines.metadata")
    async def _metadata(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await discipline_service.metadata(
                session, str(data.get("discipline") or ""), c.q1(data, "workspace_id"), c.optional_actor(data)
            )

        return await c.envelope(logger, "disciplines.metadata", op, session_factory=_SF)
