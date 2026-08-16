"""Contract guards on ``rpc.stream.tournament_streams``.

Four properties, each of which fails silently in production if it drifts:

1. **The visibility gate runs first.** The gateway caches this response with
   ``respcache.TTLOnly`` — no viewer in the cache key — so a hidden tournament
   must be rejected before a single stream row or Redis key is touched, and it
   must answer 404 rather than 403 so existence stays undisclosed.
2. **``participants`` is "who is on air", nothing else.** A channel the poller
   stamped ``source="official"`` belongs to the official block even when it has a
   ``player_id``, or the same stream renders twice.
3. **``live=None`` is not ``live=False``.** A YouTube link is never polled, so
   claiming it is offline invents a fact. Same for a Twitch URL that is not a
   channel page: there is no login to ask Helix about.
4. **Player enrichment is one query.** A tournament page can carry dozens of live
   channels, and this read is public.

No database and no Redis: the gate and the batched lookup are exercised against a
fake session that answers the two statement shapes this path issues.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, patch

backend_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_root))
sys.path.insert(0, str(backend_root / "stream-service"))

os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "postgres")
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")

from shared.core.errors import BaseAPIException as HTTPException  # noqa: E402
from shared.models.tournament.link import TournamentLink  # noqa: E402
from shared.models.tournament.tournament import Tournament  # noqa: E402
from src.rpc import reads  # noqa: E402


def _snapshot(
    channel: str,
    *,
    source: str,
    player_id: int | None = None,
    viewer_count: int | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """One poller snapshot. Note the absent ``live`` key: the field's existence in
    the hash IS the liveness signal (``src/services/state.py``)."""
    return {
        "platform": "twitch",
        "channel": channel,
        "user_id": "1234",
        "url": f"https://twitch.tv/{channel}",
        "title": title,
        "game_name": "Overwatch 2",
        "viewer_count": viewer_count,
        "thumbnail_url": f"https://static-cdn.jtvnw.net/previews/{channel}-440x248.jpg",
        "started_at": "2026-08-16T12:00:00Z",
        "player_id": player_id,
        "source": source,
    }


class _FakeRedis:
    """Serves one tournament's live hash and records that it was asked."""

    def __init__(self, snapshots: dict[str, dict[str, Any]]) -> None:
        self._snapshots = snapshots
        self.hgetall_keys: list[str] = []

    async def hgetall(self, key: str) -> dict[str, str]:
        self.hgetall_keys.append(key)
        return {field: json.dumps(snapshot) for field, snapshot in self._snapshots.items()}


class _FakeSession:
    """Answers the two statement shapes this read issues.

    ``scalar`` serves the visibility gate's tournament load; ``execute`` serves the
    batched player lookup. ``executed`` is the N+1 tripwire.
    """

    def __init__(self, tournament: Tournament | None, player_rows: list[Any] | None = None) -> None:
        self._tournament = tournament
        self._player_rows = player_rows or []
        self.executed: list[Any] = []

    async def scalar(self, statement: Any) -> Any:
        return self._tournament

    async def execute(self, statement: Any) -> Any:
        self.executed.append(statement)
        return SimpleNamespace(all=lambda: list(self._player_rows))


def _link(url: str, label: str | None = None, sort_order: int = 0) -> TournamentLink:
    return TournamentLink(tournament_id=1, kind="stream", url=url, label=label, sort_order=sort_order, is_active=True)


def _player_row(player_id: int, name: str) -> SimpleNamespace:
    return SimpleNamespace(id=player_id, name=name, avatar_url=None)


class HiddenTournamentGateTests(IsolatedAsyncioTestCase):
    async def test_hidden_tournament_404s_an_anonymous_viewer_before_reading_anything(self) -> None:
        session = _FakeSession(Tournament(id=1, workspace_id=5, is_hidden=True))
        redis = _FakeRedis({"twitch:caster": _snapshot("caster", source="official")})
        links = AsyncMock(return_value=[_link("https://twitch.tv/caster")])

        with patch.object(reads.targets, "official_stream_links", links):
            with self.assertRaises(HTTPException) as ctx:
                await reads.tournament_streams(session, redis, {"tournament_id": "1"})

        # 404, not 403: a hidden tournament and a missing one are indistinguishable.
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(ctx.exception.detail, "Tournament not found")
        # And nothing was read. An empty response would be just as wrong as a 403 --
        # it would mean the gate ran after the cacheable read it is supposed to guard.
        self.assertEqual(redis.hgetall_keys, [])
        links.assert_not_awaited()
        self.assertEqual(session.executed, [])

    async def test_visible_tournament_is_served(self) -> None:
        session = _FakeSession(Tournament(id=1, workspace_id=5, is_hidden=False))
        redis = _FakeRedis({})

        with patch.object(reads.targets, "official_stream_links", AsyncMock(return_value=[])):
            result = await reads.tournament_streams(session, redis, {"tournament_id": "1"})

        self.assertEqual(result.official, [])
        self.assertEqual(result.participants, [])
        self.assertEqual(redis.hgetall_keys, ["stream:live:1"])

    async def test_missing_tournament_id_is_unprocessable(self) -> None:
        session = _FakeSession(Tournament(id=1, workspace_id=5, is_hidden=False))
        with self.assertRaises(HTTPException) as ctx:
            await reads.tournament_streams(session, _FakeRedis({}), {})
        self.assertEqual(ctx.exception.status_code, 422)


class ParticipantsTests(IsolatedAsyncioTestCase):
    """``participants`` = the live set, minus the official broadcast, with players."""

    def setUp(self) -> None:
        self.snapshots = {
            # The official broadcast. It carries a player_id (the caster happens to
            # be a registered participant) but source wins: official block only.
            "twitch:caster": _snapshot("caster", source="official", player_id=10, viewer_count=900),
            "twitch:alice": _snapshot("alice", source="self_declared", player_id=11, viewer_count=40),
            "twitch:bob": _snapshot("bob", source="verified", player_id=12, viewer_count=120),
            # Live, but no player resolved -- nothing to attribute it to, so it is
            # neither an official link nor a participant entry.
            "twitch:stranger": _snapshot("stranger", source="verified", player_id=None),
        }
        self.session = _FakeSession(
            Tournament(id=1, workspace_id=5, is_hidden=False),
            [_player_row(11, "Alice"), _player_row(12, "Bob")],
        )
        self.redis = _FakeRedis(self.snapshots)

    async def _run(self) -> Any:
        with patch.object(
            reads.targets,
            "official_stream_links",
            AsyncMock(return_value=[_link("https://twitch.tv/caster")]),
        ):
            return await reads.tournament_streams(self.session, self.redis, {"tournament_id": "1"})

    async def test_participants_are_the_live_player_channels_only(self) -> None:
        result = await self._run()

        # Biggest audience first, so a TTL-cached response is stable across calls.
        self.assertEqual([e.channel for e in result.participants], ["bob", "alice"])
        self.assertTrue(all(e.live is True for e in result.participants))

    async def test_official_channel_is_not_repeated_as_a_participant(self) -> None:
        result = await self._run()

        self.assertEqual([e.channel for e in result.official], ["caster"])
        self.assertNotIn("caster", [e.channel for e in result.participants])
        # The official slot is the organizer's, not the caster's, even though the
        # snapshot resolved a player behind it.
        self.assertIsNone(result.official[0].player)

    async def test_players_are_enriched_in_a_single_query(self) -> None:
        result = await self._run()

        by_channel = {e.channel: e for e in result.participants}
        self.assertEqual(by_channel["alice"].player.name, "Alice")  # type: ignore[union-attr]
        self.assertEqual(by_channel["bob"].player.id, 12)  # type: ignore[union-attr]
        # Two players, one round trip. Per-entry lookups would make this len 2.
        self.assertEqual(len(self.session.executed), 1)

    async def test_live_metadata_rides_along(self) -> None:
        result = await self._run()

        bob = next(e for e in result.participants if e.channel == "bob")
        self.assertEqual(bob.viewer_count, 120)
        self.assertEqual(bob.game_name, "Overwatch 2")
        self.assertIsNotNone(bob.started_at)
        self.assertNotIn("{width}", bob.thumbnail_url or "")


class OfficialLinkLivenessTests(IsolatedAsyncioTestCase):
    """The tri-state. ``None`` means "nobody checked", and must not become False."""

    async def _official(self, links: list[TournamentLink], snapshots: dict[str, dict[str, Any]]) -> Any:
        session = _FakeSession(Tournament(id=1, workspace_id=5, is_hidden=False))
        with patch.object(reads.targets, "official_stream_links", AsyncMock(return_value=links)):
            result = await reads.tournament_streams(session, _FakeRedis(snapshots), {"tournament_id": "1"})
        return result.official

    async def test_youtube_link_is_unknown_not_offline(self) -> None:
        official = await self._official([_link("https://www.youtube.com/@aqt", label="AQT")], {})

        self.assertEqual(official[0].platform, "youtube")
        # The load-bearing assertion of this whole feature's frontend: `is None`,
        # not `is False`. False would render a grey "offline" badge on a channel
        # the poller never looks at.
        self.assertIsNone(official[0].live)
        self.assertEqual(official[0].channel, "AQT")

    async def test_twitch_non_channel_url_is_unknown(self) -> None:
        official = await self._official([_link("https://twitch.tv/videos/123456")], {})

        self.assertEqual(official[0].platform, "twitch")
        self.assertIsNone(official[0].live)

    async def test_twitch_channel_absent_from_the_live_set_is_offline(self) -> None:
        official = await self._official([_link("https://twitch.tv/caster")], {})

        # Here False is correct and None would be wrong: this channel IS polled,
        # and Helix omits offline channels from GET /streams.
        self.assertIs(official[0].live, False)
        self.assertEqual(official[0].channel, "caster")

    async def test_offline_official_link_is_still_returned(self) -> None:
        official = await self._official([_link("https://twitch.tv/caster")], {})

        self.assertEqual([e.url for e in official], ["https://twitch.tv/caster"])

    async def test_live_official_link_keeps_the_organizers_url(self) -> None:
        official = await self._official(
            [_link("https://twitch.tv/caster?lang=ru")],
            {"twitch:caster": _snapshot("caster", source="official", title="Grand Final")},
        )

        self.assertIs(official[0].live, True)
        self.assertEqual(official[0].url, "https://twitch.tv/caster?lang=ru")
        self.assertEqual(official[0].title, "Grand Final")

    async def test_links_keep_the_services_ordering(self) -> None:
        official = await self._official(
            [_link("https://twitch.tv/main", sort_order=0), _link("https://twitch.tv/second", sort_order=1)],
            {},
        )

        self.assertEqual([e.channel for e in official], ["main", "second"])


class NonTwitchPlatformStampTests(IsolatedAsyncioTestCase):
    """The read stamps whatever ``targets.platform_from_url`` says, and only Twitch
    ever gets a boolean. The host rules themselves are tested where they live
    (``tests/test_target_queries.py``) — duplicating them here would give two
    places to update when Twitch adds a host."""

    async def test_unknown_host_is_other_and_unknown(self) -> None:
        session = _FakeSession(Tournament(id=1, workspace_id=5, is_hidden=False))
        with patch.object(
            reads.targets,
            "official_stream_links",
            AsyncMock(return_value=[_link("https://kick.com/aqt", label="Kick")]),
        ):
            result = await reads.tournament_streams(session, _FakeRedis({}), {"tournament_id": "1"})

        self.assertEqual(result.official[0].platform, "other")
        self.assertIsNone(result.official[0].live)
        self.assertEqual(result.official[0].channel, "Kick")

    async def test_unlabelled_link_falls_back_to_the_host(self) -> None:
        session = _FakeSession(Tournament(id=1, workspace_id=5, is_hidden=False))
        with patch.object(
            reads.targets,
            "official_stream_links",
            AsyncMock(return_value=[_link("https://www.youtube.com/@aqt")]),
        ):
            result = await reads.tournament_streams(session, _FakeRedis({}), {"tournament_id": "1"})

        self.assertEqual(result.official[0].channel, "youtube.com")
