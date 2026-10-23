"""Typed-RPC: manual recompute of impact-scoring baselines (superuser)."""

from __future__ import annotations

from typing import Any

from faststream.rabbit import RabbitMessage

from shared.disciplines import DISCIPLINES
from src.core import db

from . import _common as c

_SF = db.async_session_maker


def register(broker: Any, logger: Any) -> None:
    @broker.subscriber("rpc.stats.impact.recompute_baselines")
    async def _recompute(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            c.require_superuser(c.actor(data))
            return await DISCIPLINES["overwatch"].collection_handlers["impact.recompute_baselines"](session, None, data)

        return await c.envelope(logger, "impact.recompute_baselines", op, session_factory=_SF)
