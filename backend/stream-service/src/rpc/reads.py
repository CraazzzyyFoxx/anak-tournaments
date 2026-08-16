"""Public read subscribers (``rpc.stream.tournament_streams``).

Serves ``GET /api/streams/tournament/{tournament_id}`` — the "who is on air"
block of a tournament page, for anonymous viewers.

Two sources, joined here and nowhere else:

* **official** — ``tournament.tournament_link`` rows with ``kind='stream'``, read
  through ``src.services.targets.official_stream_links`` so the poll tick and this
  read can never disagree about which links exist or in what order. Offline links
  stay in the response: the link is worth showing whether or not anyone is on air.
* **participants** — the Redis live set the poller rebuilds each tick
  (``src.services.state``). Only live channels exist there by construction, so
  this list is inherently "currently on air".

URL parsing also comes from ``targets``: the same function decides what the poller
asks Helix about and what this read calls a Twitch channel, which is what keeps
``live=False`` ("polled, offline") from being confused with ``live=None`` ("never
polled").

This module is READ-ONLY with respect to Postgres. It touches ``tournament.*`` and
``players.*``, both owned by other services
(``backend/docs/tournament-service-write-path-inventory.md``), so there is no
``session.add`` and no ``commit`` anywhere in this path.
"""

from __future__ import annotations

from typing import Any, cast
from urllib.parse import urlsplit

import sqlalchemy as sa
from faststream.rabbit.annotations import RabbitMessage
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.identity.user import User
from shared.models.tournament.link import TournamentLink
from shared.services.tournament_visibility import assert_tournament_viewable
from src.core import db
from src.schemas.stream import StreamEntryRead, StreamPlatform, StreamPlayerRead, TournamentStreamsRead
from src.services import state, targets

from . import _common as c
from ._clients import realtime_redis

__all__ = ("build_tournament_streams", "register", "tournament_streams")

_PLATFORMS: frozenset[str] = frozenset({"twitch", "youtube", "other"})


def _platform(url: str) -> StreamPlatform:
    """``targets.platform_from_url`` narrowed to the wire Literal."""
    return cast(StreamPlatform, targets.platform_from_url(url))


def _display_channel(url: str, label: str | None) -> str:
    """Channel caption for a link with no pollable login (YouTube, custom hosts).

    The organizer's own label wins; the host is the fallback so the entry never
    renders as an empty string.
    """
    host = (urlsplit(url).hostname or "").lower().removeprefix("www.")
    return label or host or url


def _snapshot_platform(field: str, snapshot: dict[str, Any]) -> StreamPlatform:
    raw = str(snapshot.get("platform") or field.split(":", 1)[0])
    # The Literal is the wire contract; an unexpected value from our own writer
    # degrades to "other" rather than 422-ing the whole public block.
    return cast(StreamPlatform, raw if raw in _PLATFORMS else "other")


def _player_id(snapshot: dict[str, Any]) -> int | None:
    raw = snapshot.get("player_id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


async def _load_players(session: AsyncSession, player_ids: set[int]) -> dict[int, StreamPlayerRead]:
    """Names and avatars for every streaming participant, in ONE query.

    Batched deliberately: a tournament page can carry dozens of live channels and a
    per-entry lookup would put that many round-trips on a public, cacheable read.
    """
    if not player_ids:
        return {}
    rows = await session.execute(sa.select(User.id, User.name, User.avatar_url).where(User.id.in_(player_ids)))
    return {
        int(row.id): StreamPlayerRead(id=int(row.id), name=row.name, avatar_url=row.avatar_url) for row in rows.all()
    }


def _entry_from_snapshot(
    field: str,
    snapshot: dict[str, Any],
    *,
    player: StreamPlayerRead | None,
) -> StreamEntryRead:
    """Build a live entry from a Redis snapshot.

    ``live=True`` unconditionally: the hash holds only channels Helix reported as
    live and ``state.write_live`` replaces the whole set each tick, so the field's
    existence IS the liveness signal. The snapshot carries no ``live`` key on
    purpose — an always-true field would invite a reader to trust a stale one.
    """
    channel = str(snapshot.get("channel") or field.split(":", 1)[-1])
    return StreamEntryRead(
        platform=_snapshot_platform(field, snapshot),
        channel=channel,
        url=str(snapshot.get("url") or f"https://twitch.tv/{channel}"),
        live=True,
        title=snapshot.get("title"),
        game_name=snapshot.get("game_name"),
        viewer_count=snapshot.get("viewer_count"),
        thumbnail_url=snapshot.get("thumbnail_url"),
        started_at=snapshot.get("started_at"),
        player=player,
    )


def _official_entry(link: TournamentLink, live: dict[str, dict[str, Any]]) -> StreamEntryRead:
    """Build an entry for one ``kind='stream'`` link, live or not.

    ``player`` stays ``None`` even when the poller matched the channel to a
    participant: this is the organizer's broadcast slot, and attributing it to one
    of the players would misrepresent it.
    """
    url = str(link.url)
    platform = _platform(url)
    channel = targets.twitch_channel_from_url(url)
    snapshot = live.get(state.snapshot_field(platform, channel)) if channel else None
    if snapshot is not None:
        # On air: live metadata from the poller, but the organizer's own URL —
        # theirs may carry query params the snapshot's canonical form drops.
        return StreamEntryRead(
            platform=platform,
            channel=channel or "",
            url=url,
            live=True,
            title=snapshot.get("title"),
            game_name=snapshot.get("game_name"),
            viewer_count=snapshot.get("viewer_count"),
            thumbnail_url=snapshot.get("thumbnail_url"),
            started_at=snapshot.get("started_at"),
        )
    return StreamEntryRead(
        platform=platform,
        channel=channel or _display_channel(url, link.label),
        url=url,
        # False only where a poll actually happens; otherwise unknown. See
        # ``StreamEntryRead.live``.
        live=False if channel else None,
    )


async def build_tournament_streams(
    session: AsyncSession,
    redis: Redis,
    tournament_id: int,
) -> TournamentStreamsRead:
    """Assemble the stream block. Caller MUST have gated visibility already."""
    live = await state.read_live(redis, tournament_id)
    links = await targets.official_stream_links(session, tournament_id)
    official = [_official_entry(link, live) for link in links]

    # ``source`` is the poller's own dedup marker: a channel that is both the
    # official broadcast and a participant's is stamped "official" and belongs in
    # the official block only, so it is not rendered twice.
    live_participants = [
        (field, snapshot)
        for field, snapshot in live.items()
        if snapshot.get("source") != "official" and _player_id(snapshot) is not None
    ]
    players = await _load_players(
        session, {pid for _, snapshot in live_participants if (pid := _player_id(snapshot)) is not None}
    )
    participants = [
        _entry_from_snapshot(field, snapshot, player=players.get(_player_id(snapshot) or 0))
        for field, snapshot in live_participants
    ]
    # Redis hash order is arbitrary; sort so the response is stable across calls
    # (it is served from a TTL cache) and the biggest audience leads.
    participants.sort(key=lambda entry: (-(entry.viewer_count or 0), entry.channel))
    return TournamentStreamsRead(official=official, participants=participants)


async def tournament_streams(session: AsyncSession, redis: Redis, data: dict[str, Any]) -> TournamentStreamsRead:
    """Gate, then read. The order is the contract, not a style choice.

    ``assert_tournament_viewable`` runs FIRST, before a single stream row or Redis
    key is touched: the gateway caches this response without the viewer in the key
    (``respcache.TTLOnly``), so an ineligible viewer must be rejected before the
    shared cache is consulted (see ``shared/services/tournament_visibility.py``).
    A hidden tournament answers 404, not 403 — existence itself is not disclosed.
    """
    tournament_id = c.require_path_int(data, "tournament_id")
    await assert_tournament_viewable(session, c.optional_actor(data), tournament_id)
    return await build_tournament_streams(session, redis, tournament_id)


def register(broker: Any, logger: Any) -> None:
    sf = db.async_session_maker

    @broker.subscriber("rpc.stream.tournament_streams")
    async def _tournament_streams(data: dict, msg: RabbitMessage) -> dict:
        async def op(session: Any) -> Any:
            return await tournament_streams(session, realtime_redis, data)

        # exclude_none stays OFF (the envelope default): `live: null` MUST appear
        # on the wire. Dropping it would make "no live detection" indistinguishable
        # from a missing field on the frontend, which is the one distinction this
        # response exists to carry.
        return await c.envelope(logger, "tournament_streams", op, session_factory=sf)
