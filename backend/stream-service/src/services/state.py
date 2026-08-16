"""Redis-backed live-stream state for stream-svc.

This service owns **no Postgres schema**. Live status is definitionally
ephemeral — a stale "on air" badge is worse than no badge — so it lives in Redis
under a TTL and is rebuilt from Twitch on every poll tick. That choice removes
six integration points a table would have cost (migration, ``CREATE SCHEMA``, the
``SCHEMAS`` tuple, model registration, a repository, and the repository-boundary
guard) in exchange for data whose useful life is one poll interval.

ponytail: no history. A Redis flush leaves badges dark until the next tick, and
there is no record of who streamed a past tournament. Upgrade path if a
"tournament stream history" report is ever wanted: a table in a ``streams``
schema, written alongside these keys — see
``docs/superpowers/specs/2026-08-16-tournament-streams-design.md`` Decision D2.

Key layout (single source of truth — do not spell these out elsewhere):

===================================  =====  ==========================================
Key                                  Type   Contents
===================================  =====  ==========================================
``stream:live:{tournament_id}``      HASH   field ``{platform}:{channel}`` -> snapshot
``stream:token``                     STR    Helix app access token
``stream:poll:last_run``             STR    unix ts of the last completed tick
===================================  =====  ==========================================
"""

from __future__ import annotations

import json
from typing import Any

from redis.asyncio import Redis

__all__ = (
    "LAST_RUN_KEY",
    "LAST_RUN_TTL_SECONDS",
    "TOKEN_KEY",
    "clear_last_run",
    "get_last_run",
    "live_key",
    "read_live",
    "set_last_run",
    "snapshot_field",
    "write_live",
)

TOKEN_KEY = "stream:token"
LAST_RUN_KEY = "stream:poll:last_run"
#: The cursor only gates "is the next tick due"; a lost key costs one early tick,
#: so it expires rather than accumulating forever in a shared Redis.
LAST_RUN_TTL_SECONDS = 24 * 60 * 60


def live_key(tournament_id: int) -> str:
    return f"stream:live:{int(tournament_id)}"


def snapshot_field(platform: str, channel: str) -> str:
    """Hash field for one channel. Platform-qualified because the same handle can
    exist on two platforms and they are different streams."""
    return f"{platform}:{channel.casefold()}"


async def read_live(redis: Redis, tournament_id: int) -> dict[str, dict[str, Any]]:
    """Currently-live channels for a tournament, keyed by :func:`snapshot_field`.

    Returns an empty mapping when the key is absent or expired — "we do not know"
    and "nobody is live" are the same answer to a reader, and both mean the page
    shows no live badge.
    """
    raw = await redis.hgetall(live_key(tournament_id))
    if not raw:
        return {}
    snapshots: dict[str, dict[str, Any]] = {}
    for field, value in raw.items():
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            # A malformed field is a bug in the writer, not a reason to blank the
            # whole block for every viewer. Skip it; the next tick overwrites.
            continue
        if isinstance(decoded, dict):
            snapshots[field] = decoded
    return snapshots


async def write_live(
    redis: Redis,
    tournament_id: int,
    snapshots: dict[str, dict[str, Any]],
    *,
    ttl_seconds: int,
) -> None:
    """Replace the whole live set for a tournament, atomically.

    Full replacement, not a merge: a channel that dropped off the Helix response
    went offline, and merging would leave it "live" forever. The DELETE+HSET pair
    runs in one pipeline so a reader never observes the empty window between them.
    An empty ``snapshots`` deletes the key outright.
    """
    key = live_key(tournament_id)
    async with redis.pipeline(transaction=True) as pipe:
        pipe.delete(key)
        if snapshots:
            pipe.hset(key, mapping={field: json.dumps(snapshot) for field, snapshot in snapshots.items()})
            pipe.expire(key, ttl_seconds)
        await pipe.execute()


async def get_last_run(redis: Redis) -> float | None:
    raw = await redis.get(LAST_RUN_KEY)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


async def set_last_run(redis: Redis, timestamp: float) -> None:
    await redis.set(LAST_RUN_KEY, repr(float(timestamp)), ex=LAST_RUN_TTL_SECONDS)


async def clear_last_run(redis: Redis) -> None:
    """Make the next heartbeat due immediately — the admin re-poll's whole job."""
    await redis.delete(LAST_RUN_KEY)
