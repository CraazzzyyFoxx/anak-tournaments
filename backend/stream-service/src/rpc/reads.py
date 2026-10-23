"""Public read subscriber ``rpc.stream.tournament_streams``.

Serves ``GET /api/streams/tournament/{tournament_id}`` — the "who is on air" block
of a tournament page, for anonymous viewers.
"""

from __future__ import annotations

from typing import Any

from faststream.rabbit.annotations import RabbitMessage
from redis.asyncio import Redis

from shared.services.tournament.visibility import ensure_tournament_viewable
from src.core import db
from src.core.clients import realtime_redis
from src.schemas.stream import TournamentStreamsRead
from src.services.tournament_streams import tournament_streams_reader

from . import _common as c

__all__ = ("register", "tournament_streams")


async def tournament_streams(session: Any, redis: Redis, data: dict[str, Any]) -> TournamentStreamsRead:
    """Gate, then read. The order is the contract.

    ``ensure_tournament_viewable`` runs FIRST, before a single stream row or Redis
    key is touched: the gateway caches this response without the viewer in the key
    (``respcache.TTLOnly``), so an ineligible viewer must be rejected before the
    shared cache is consulted. A hidden tournament answers 404, not 403.
    """
    tournament_id = c.require_path_int(data, "tournament_id")
    await ensure_tournament_viewable(session, c.optional_actor(data), tournament_id)
    return await tournament_streams_reader.build(session, redis, tournament_id)


def register(broker: Any, logger: Any) -> None:
    sf = db.async_session_maker

    @broker.subscriber("rpc.stream.tournament_streams")
    async def _tournament_streams(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await tournament_streams(session, realtime_redis, data)

        # exclude_none stays OFF (the envelope default): `live: null` MUST appear on
        # the wire, or "no live detection" is indistinguishable from a missing field.
        return await c.envelope(logger, "tournament_streams", op, session_factory=sf)
