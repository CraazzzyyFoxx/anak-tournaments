"""Response models for the ``rpc.stream.*`` contract.

These are the wire shape of the public tournament-streams block. The hand-written
frontend mirror is ``frontend/src/types/stream.types.ts`` (no OpenAPI codegen in
this project) — the two are kept in sync by eye, so field names and nullability
here are the contract, not an implementation detail.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from src.schemas.base import BaseRead

__all__ = (
    "StreamEntryRead",
    "StreamPlatform",
    "StreamPlayerRead",
    "StreamRepollRead",
    "TournamentStreamsRead",
)

#: Detected from the link's host. ``other`` is not an error state — a link the
#: organizer typed is still worth rendering, it just has no player embed.
StreamPlatform = Literal["twitch", "youtube", "other"]


class StreamPlayerRead(BaseRead):
    """The player behind a participant stream. Absent for an official broadcast."""

    name: str
    avatar_url: str | None = None


class StreamEntryRead(BaseModel):
    """One channel in the tournament's stream block."""

    platform: StreamPlatform
    #: Twitch login (lowercase), or a human-readable channel identifier — the
    #: organizer's link label, falling back to the host — on other platforms.
    channel: str
    url: str
    live: bool | None
    """Tri-state, and the ``None`` case is load-bearing.

    ``True``/``False`` — the poller HAS live detection for this channel (a
    ``twitch.tv/{login}`` page) and reports the current state; absence from the
    Redis live set means offline. ``None`` — there IS NO live detection for this
    channel: YouTube and other hosts are never polled (design A4), and neither is
    a Twitch URL that is not a channel page (``twitch.tv/videos/123``).

    ``None`` is NOT ``False``. "We do not know" must render as NO badge at all,
    not as a grey "offline" badge — see ``STREAM_STATUS_META`` in
    ``frontend/src/lib/stream-platform.ts``. Claiming a caster is offline when
    nobody ever checked is the one wrong answer here.
    """
    title: str | None = None
    game_name: str | None = None
    viewer_count: int | None = None
    #: Already sized (440x248) by the Helix client — never carries Twitch's
    #: ``{width}x{height}`` placeholders.
    thumbnail_url: str | None = None
    started_at: datetime | None = None
    player: StreamPlayerRead | None = None


class TournamentStreamsRead(BaseModel):
    """The whole stream block for one tournament."""

    #: Official broadcast links from ``tournament.tournament_link``, live or not —
    #: the link itself is always worth showing, so offline entries stay in.
    official: list[StreamEntryRead]
    #: Participant streams, and only the ones currently live: this list answers
    #: "who is on air right now", so an offline participant has nothing to say.
    participants: list[StreamEntryRead]


class StreamRepollRead(BaseModel):
    """202 body for ``rpc.stream.repoll``.

    Deliberately just the id: the handler does not run a poll tick, it clears the
    poll cursor so the next scheduler heartbeat is due immediately. "Accepted, not
    done" is what the 202 already says, so a constant ``queued: true`` field would
    add a word and no information.
    """

    tournament_id: int
