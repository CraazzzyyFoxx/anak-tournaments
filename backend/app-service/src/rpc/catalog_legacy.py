"""Public lookup of an old catalog id in ``catalog.entity_legacy``: what the site's proxy redirects old links
through."""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from src.core import db
from src.services import catalog_legacy

from . import _common as c

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.app.catalog.legacy")
    async def _legacy(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await catalog_legacy.resolve(
                session, str(data.get("legacy_kind") or ""), str(data.get("legacy_id") or "")
            )

        return await c.envelope(logger, "catalog.legacy", op, session_factory=_SF)
