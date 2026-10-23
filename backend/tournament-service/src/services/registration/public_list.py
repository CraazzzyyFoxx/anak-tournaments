"""The public registration list: cached, and built once per burst of concurrent readers."""

from __future__ import annotations

import asyncio
from typing import Any

from cashews.exceptions import CacheBackendInteractionError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from shared.services.cache_generations import current, versioned
from src.core.config import settings
from src.services.registration.service import registration_service
from src.services.tournament.cache_resources import REGISTRATION_LIST, tournament_generations

__all__ = ("build_registration_list", "coalesced_registration_list")

# Single-flight per tournament_id: one registration mutation makes every
# connected viewer refetch at once, and N identical builds would queue behind
# the rpc channel's ``prefetch_count``. Followers await the leader's task.
# Keyed by tournament_id, not by viewer: callers run the viewer-dependent
# visibility gate on their own session before reaching this, so no follower
# skips it. And keyed by the list's generations: a request arriving after a
# write starts its own build instead of joining one that read before it.
_inflight: dict[tuple[int, str | None], asyncio.Task[Any]] = {}


# Values outlive a deploy in Redis and come back unvalidated, so a shape change
# bumps the key version.
@versioned(
    generations=tournament_generations("{tournament_id}", REGISTRATION_LIST),
    ttl=settings.tournaments_cache_ttl,
    key="registration_list:v2:{tournament_id}:",
    prefix="fastapi:",
)
async def build_registration_list(session_maker: async_sessionmaker[AsyncSession], tournament_id: int) -> Any:
    """Build the list on a session of its own.

    The result is shared by every concurrent follower, so it cannot ride any one
    caller's session.
    """
    async with session_maker() as session:
        return await registration_service.build_public_registration_list(session, tournament_id=tournament_id)


async def coalesced_registration_list(session_maker: async_sessionmaker[AsyncSession], tournament_id: int) -> Any:
    try:
        generation = await current(*tournament_generations(str(tournament_id), REGISTRATION_LIST))
    except CacheBackendInteractionError:
        generation = None  # the build bypasses the cache too; coalescing is all that is left
    flight = (tournament_id, generation)
    task = _inflight.get(flight)
    if task is None:
        task = asyncio.create_task(build_registration_list(session_maker, tournament_id))
        _inflight[flight] = task

        def _cleanup(done: asyncio.Task[Any]) -> None:
            if _inflight.get(flight) is done:
                del _inflight[flight]

        task.add_done_callback(_cleanup)
    # Shielded: a follower's own cancellation (its caller disconnected/timed
    # out) must not cancel the shared build out from under every other
    # follower -- and unlike a plain ``await task``, ``Task.cancel()`` DOES
    # propagate into whatever future a task is currently awaiting.
    return await asyncio.shield(task)
