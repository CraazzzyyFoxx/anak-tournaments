from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any

from loguru import logger
from pydantic import RedisDsn
from redis.asyncio import Redis

from src.core import config
from src.services.tournament.realtime import tournament_realtime_manager


def _redis_url(value: RedisDsn | str) -> str:
    return str(value)


def encode_tournament_update(tournament_id: int, reason: str) -> str:
    return json.dumps(
        {
            "tournament_id": tournament_id,
            "reason": reason,
        },
        separators=(",", ":"),
    )


async def publish_tournament_update(
    tournament_id: int,
    reason: str,
    *,
    redis_url: RedisDsn | str | None = None,
    channel: str | None = None,
) -> None:
    redis = Redis.from_url(
        _redis_url(redis_url or config.settings.redis_url),
        decode_responses=True,
    )
    try:
        await redis.publish(
            channel or config.settings.realtime_pubsub_channel,
            encode_tournament_update(tournament_id, reason),
        )
    finally:
        await redis.aclose()


async def handle_tournament_pubsub_message(data: str | bytes | dict[str, Any]) -> None:
    if isinstance(data, bytes):
        data = data.decode()
    payload = json.loads(data) if isinstance(data, str) else data
    await tournament_realtime_manager.broadcast_updated(
        int(payload["tournament_id"]),
        str(payload["reason"]),
    )


class TournamentRealtimePubSub:
    def __init__(
        self,
        *,
        redis_url: RedisDsn | str | None = None,
        channel: str | None = None,
    ) -> None:
        self._redis_url = _redis_url(redis_url or config.settings.redis_url)
        self._channel = channel or config.settings.realtime_pubsub_channel
        self._redis = Redis.from_url(self._redis_url, decode_responses=True)
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="tournament-realtime-pubsub")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._redis.aclose()

    async def _run(self) -> None:
        while True:
            try:
                async with self._redis.pubsub() as pubsub:
                    await pubsub.subscribe(self._channel)
                    async for message in pubsub.listen():
                        if message.get("type") != "message":
                            continue
                        await handle_tournament_pubsub_message(message["data"])
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Tournament realtime Redis subscriber failed")
                await asyncio.sleep(5)
