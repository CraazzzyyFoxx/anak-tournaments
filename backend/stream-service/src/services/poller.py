"""One Twitch live-status poll tick.

Shape of the tick, and why:

- **One global batch, not one per tournament.** A caster streaming two
  tournaments in the same evening is one channel; asking Helix about them
  separately doubles the cost against a bucket shared with identity-service's
  OAuth logins. Channels are deduped across every polled tournament, polled once,
  and the answer is fanned back out.
- **Absence means offline.** ``GET /streams`` only returns live channels, so the
  live set is *replaced* per tournament rather than merged. That is also why a
  truncated poll may not be written: a channel nobody asked about would be
  recorded as offline, and viewers would watch badges flicker off mid-tournament.
- **One realtime signal per tournament, never per channel.** A tournament page has
  hundreds of concurrent spectators on one topic; a per-channel fan-out would turn
  a five-caster event into five herd refetches (Risks, "herd refetch").
- **A hidden tournament is polled and stored, but not announced.** The public
  topic has no viewer to authorize against, so publishing there would tell an
  anonymous subscriber that a preview tournament exists.

State lives in ``state.py`` (Redis) — this module owns no persistence and writes
to no Postgres schema.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from loguru import logger
from redis.asyncio import Redis

from shared.schemas.realtime import WorkspaceEventEnvelope
from shared.schemas.settings import StreamCollectionConfig
from shared.services import realtime_topics
from shared.services.realtime_publisher import publish_envelope_to_redis
from src.core import metrics
from src.core.config import settings
from src.services import helix, state, targets

__all__ = ("STREAM_UPDATED", "run_poll_tick")

STREAM_UPDATED = "stream.updated"


#: Injection seam for the tick's only network call. Kept loose (``...``) rather
#: than a Protocol because ``helix.fetch_live_streams`` carries defaulted knobs
#: the tick never passes, and a Protocol would have to restate all of them.
LiveStreamFetcher = Callable[..., Awaitable[helix.HelixBatchResult]]


@dataclass(frozen=True, slots=True)
class _Channel:
    """A channel as one tournament sees it — the same login can carry a different
    owner and a different consent source in another tournament."""

    login: str
    player_id: int | None
    provider_user_id: str | None
    source: str  # "official" | "verified" | "self_declared"


@dataclass(frozen=True, slots=True)
class _Plan:
    tournament: targets.ActiveTournament
    channels: dict[str, _Channel]


async def run_poll_tick(
    session: Any,
    redis: Redis,
    cfg: StreamCollectionConfig,
    *,
    fetch: LiveStreamFetcher = helix.fetch_live_streams,
) -> int:
    """Poll every active tournament once. Returns the number of tournaments updated.

    ``fetch`` is injected so the whole tick — dedup, fan-out, diffing, the hidden
    tournament rule — is testable without a network or a Twitch application.
    """
    if not cfg.enabled:
        logger.debug("Stream collection disabled in settings; skipping tick")
        return 0

    try:
        return await _run_tick(session, redis, cfg, fetch)
    finally:
        # Set unconditionally, not only on success. The cursor spaces *attempts*,
        # and a Twitch outage that skipped it would turn the 30s heartbeat into a
        # retry storm on a rate-limit bucket identity-service also needs.
        await state.set_last_run(redis, time.time())


async def _run_tick(session: Any, redis: Redis, cfg: StreamCollectionConfig, fetch: LiveStreamFetcher) -> int:
    plans = await _build_plans(session)
    if not plans:
        metrics.STREAM_POLL_TICKS_TOTAL.labels(status="empty").inc()
        return 0

    logins, user_ids, query_keys = _global_targets(plans)
    metrics.STREAM_CHANNELS_POLLED.set(len(query_keys))

    result = await _fetch(redis, cfg, fetch, logins=logins, user_ids=user_ids)
    if result is None:
        return 0

    if result.ratelimit_remaining is not None:
        metrics.STREAM_HELIX_RATELIMIT_REMAINING.set(result.ratelimit_remaining)
    metrics.STREAM_LIVE_CHANNELS.set(len(result.snapshots))

    live_by_login = {snapshot.channel: snapshot for snapshot in result.snapshots}
    polled = {
        login
        for login, (param, value) in query_keys.items()
        if value in (result.polled_user_ids if param == "user_id" else result.polled_logins)
    }

    processed = 0
    for plan in plans:
        if not plan.channels.keys() <= polled:
            # Partial coverage is not a partial answer: writing it would mark the
            # unpolled channels offline. Left untouched, they keep the previous
            # tick's state until its TTL (3 x interval) or the next full tick.
            logger.warning(
                "Rate-limit gate stopped the poll before tournament {}; leaving its live set untouched",
                plan.tournament.tournament_id,
            )
            continue
        await _apply(redis, cfg, plan, live_by_login)
        processed += 1

    metrics.STREAM_POLL_TICKS_TOTAL.labels(status="truncated" if result.truncated else "ok").inc()
    if result.truncated:
        logger.warning(
            "Helix rate-limit floor reached (remaining={}); polled {}/{} tournaments",
            result.ratelimit_remaining,
            processed,
            len(plans),
        )
    return processed


async def _build_plans(session: Any) -> list[_Plan]:
    """Resolve every active tournament to its channel set.

    Official links are folded in *after* participants and win the ``source`` slot
    while keeping any player the channel was already matched to: a caster who also
    plays appears once, in the official block, still attributed.
    """
    plans: list[_Plan] = []
    for tournament in await targets.active_tournament_ids(session):
        channels: dict[str, _Channel] = {}
        for participant in await targets.participant_channels(session, tournament.tournament_id):
            channels[participant.login] = _Channel(
                login=participant.login,
                player_id=participant.player_id,
                provider_user_id=participant.provider_user_id,
                source=participant.source,
            )
        for link in await targets.official_stream_links(session, tournament.tournament_id):
            login = targets.twitch_channel_from_url(link.url)
            if login is None:
                # A YouTube link or a Twitch VOD: renderable, not pollable. The RPC
                # read serves it with live=None ("no detection"), not live=False.
                continue
            known = channels.get(login)
            channels[login] = _Channel(
                login=login,
                player_id=known.player_id if known else None,
                provider_user_id=known.provider_user_id if known else None,
                source="official",
            )
        plans.append(_Plan(tournament=tournament, channels=channels))
    return plans


def _global_targets(plans: list[_Plan]) -> tuple[list[str], list[str], dict[str, tuple[str, str]]]:
    """Collapse every tournament's channels into one query set.

    Returns the logins to ask by name, the ids to ask by id, and the map from
    login to the identifier actually used — needed afterwards to tell which
    tournaments the rate-limit gate managed to cover.
    """
    query_keys: dict[str, tuple[str, str]] = {}
    for plan in plans:
        for login, channel in plan.channels.items():
            existing = query_keys.get(login)
            if existing is not None and existing[0] == "user_id":
                continue
            if channel.provider_user_id:
                # A verified account anywhere upgrades the whole login to an id
                # lookup: ids survive a channel rename, logins do not.
                query_keys[login] = ("user_id", channel.provider_user_id)
            elif existing is None:
                query_keys[login] = ("user_login", login)

    logins = sorted(login for login, (param, _) in query_keys.items() if param == "user_login")
    user_ids = sorted({value for param, value in query_keys.values() if param == "user_id"})
    return logins, user_ids, query_keys


async def _fetch(
    redis: Redis,
    cfg: StreamCollectionConfig,
    fetch: LiveStreamFetcher,
    *,
    logins: list[str],
    user_ids: list[str],
) -> helix.HelixBatchResult | None:
    """Run the Helix call, mapping every failure onto a metric and a skipped tick.

    ``None`` means "we learned nothing" — the caller must not write anything,
    because an empty snapshot set and an unanswered request look identical
    downstream and only one of them means "everybody went offline".
    """
    if not logins and not user_ids:
        # Nothing to ask, but still a real answer: every active tournament has an
        # empty live set, which the fan-out below writes (clearing stale badges).
        return helix.HelixBatchResult(snapshots=[])

    try:
        result: helix.HelixBatchResult = await fetch(
            redis,
            logins=logins,
            user_ids=user_ids,
            client_id=settings.twitch_client_id,
            client_secret=settings.twitch_client_secret,
            helix_url=settings.twitch_helix_url,
            token_url=settings.twitch_token_url,
            proxy=settings.proxy_url,
            batch_size=cfg.batch_size,
        )
    except helix.HelixNotConfigured:
        # Expected state, not an incident: the feature ships inert until an
        # operator sets TWITCH_CLIENT_ID/SECRET.
        metrics.STREAM_HELIX_ERRORS_TOTAL.labels(kind="not_configured").inc()
        metrics.STREAM_POLL_TICKS_TOTAL.labels(status="not_configured").inc()
        logger.debug("Twitch credentials are not configured; skipping stream poll tick")
        return None
    except helix.HelixRateLimited as exc:
        metrics.STREAM_HELIX_ERRORS_TOTAL.labels(kind="rate_limited").inc()
        metrics.STREAM_POLL_TICKS_TOTAL.labels(status="rate_limited").inc()
        logger.warning("Helix rate-limited the poll tick (reset_at={})", exc.reset_at)
        return None
    except helix.HelixUnauthorized:
        metrics.STREAM_HELIX_ERRORS_TOTAL.labels(kind="unauthorized").inc()
        metrics.STREAM_POLL_TICKS_TOTAL.labels(status="unauthorized").inc()
        logger.error("Twitch rejected the app credentials; stream polling is disabled until they are fixed")
        return None
    except helix.HelixUnavailable as exc:
        metrics.STREAM_HELIX_ERRORS_TOTAL.labels(kind="unavailable").inc()
        metrics.STREAM_POLL_TICKS_TOTAL.labels(status="unavailable").inc()
        logger.warning("Helix unavailable during stream poll tick: {}", exc)
        return None
    return result


async def _apply(
    redis: Redis,
    cfg: StreamCollectionConfig,
    plan: _Plan,
    live_by_login: dict[str, helix.StreamSnapshot],
) -> None:
    """Store one tournament's live set and, if the *set* changed, announce it."""
    snapshots: dict[str, dict[str, Any]] = {}
    for login, channel in plan.channels.items():
        found = live_by_login.get(login)
        if found is None:
            continue
        body = found.as_dict()
        body["player_id"] = channel.player_id
        body["source"] = channel.source
        snapshots[state.snapshot_field(found.platform, login)] = body

    tournament_id = plan.tournament.tournament_id
    previous = await state.read_live(redis, tournament_id)
    # Written every tick even when the membership is unchanged: viewer counts,
    # titles and the key's TTL all go stale otherwise.
    await state.write_live(redis, tournament_id, snapshots, ttl_seconds=3 * cfg.interval_seconds)

    if previous.keys() == snapshots.keys():
        # Someone's viewer count ticking up is not worth waking every open page.
        return
    if plan.tournament.is_hidden:
        logger.debug("Tournament {} is hidden; live set stored but not published", tournament_id)
        return
    await _publish(redis, tournament_id, len(snapshots))


async def _publish(redis: Redis, tournament_id: int, live_count: int) -> None:
    """Thin ``stream.updated`` on the public spectator topic.

    Non-durable (``event_id=0``, no ``realtime.workspace_event`` row) for the same
    reason as ``logs.updated``/``subscription.updated``: a reconnecting client
    refetches anyway, so persisting a row per channel going live buys nothing.
    Carries no channel data — the authoritative read is the RPC, which applies the
    visibility rules this signal has no way to.
    """
    envelope = WorkspaceEventEnvelope(
        event_id=0,
        event_type=STREAM_UPDATED,
        schema_version=1,
        occurred_at=datetime.now(UTC),
        actor_user_id=None,
        data={"tournament_id": int(tournament_id), "live_count": int(live_count)},
    )
    try:
        await publish_envelope_to_redis(redis, topic=realtime_topics.streams(tournament_id), envelope=envelope)
    except Exception:  # pragma: no cover - best-effort signal, Redis write already landed
        logger.exception(f"Failed to publish stream.updated for tournament {tournament_id}")
