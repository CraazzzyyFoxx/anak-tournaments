"""Poller operations for the admin panel: health snapshot, tick history, re-poll.

``repoll`` does NOT run a poll tick. A tick walks every active tournament and talks
to Helix; the gateway puts a deadline on every RPC (``DeadlineDropMiddleware``), so
doing it inline would time out the request. Instead it clears the poll cursor
(``stream:poll:last_run``), making the next scheduler heartbeat — at most
``SCHEDULER_TICK_SECONDS`` away — due. That is what the route's 202 Accepted means.

``health`` is why the tick records its outcome at all: every Helix failure is
swallowed so an outage cannot kill the scheduler, so a misconfigured poller is
otherwise indistinguishable from a working one. ``health``/``ticks`` read Redis
for the recorded outcome; ``health`` adds the live config from Postgres.
"""

from __future__ import annotations

from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from shared import quota
from shared.core import http_status as status
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.identity.auth_user import AuthUser
from shared.repository import TournamentRepository
from shared.services.audit import record_audit
from shared.services.settings_provider import settings_provider
from src.core.config import settings
from src.schemas.stream import StreamPollHealthRead, StreamPollTickRead, StreamRepollRead
from src.services.state import StreamStateStore

__all__ = ("StreamAdminService", "stream_admin_service")


class StreamAdminService:
    def __init__(self, *, tournaments: TournamentRepository = TournamentRepository()) -> None:
        self._tournaments = tournaments

    async def health(self, session: AsyncSession, redis: Redis) -> StreamPollHealthRead:
        """Report the last tick's outcome next to the config that produced it."""
        cfg = await settings_provider.get_stream_collection_config(session)

        recorded = await StreamStateStore(redis).read_poll_status() or {}
        ran_at = recorded.get("ran_at")
        return StreamPollHealthRead(
            enabled=cfg.enabled,
            interval_seconds=cfg.interval_seconds,
            batch_size=cfg.batch_size,
            status=recorded.get("status"),
            last_run_at=datetime.fromtimestamp(float(ran_at), tz=UTC) if ran_at is not None else None,
            tournaments_active=recorded.get("tournaments_active"),
            tournaments_updated=recorded.get("tournaments_updated"),
            channels_polled=recorded.get("channels_polled"),
            live_channels=recorded.get("live_channels"),
            ratelimit_remaining=recorded.get("ratelimit_remaining"),
            credentials_configured=bool(settings.twitch_client_id and settings.twitch_client_secret),
        )

    async def ticks(self, redis: Redis) -> list[StreamPollTickRead]:
        """Recorded poll ticks, newest first."""
        history = await StreamStateStore(redis).read_poll_history()
        return [
            StreamPollTickRead(
                ran_at=datetime.fromtimestamp(float(entry["ran_at"]), tz=UTC),
                status=entry["status"],
                tournaments_active=entry.get("tournaments_active") or 0,
                tournaments_updated=entry.get("tournaments_updated") or 0,
                channels_polled=entry.get("channels_polled") or 0,
                live_channels=entry.get("live_channels") or 0,
                ratelimit_remaining=entry.get("ratelimit_remaining"),
            )
            for entry in history
            if entry.get("ran_at") is not None and entry.get("status") is not None
        ]

    async def repoll(
        self,
        session: AsyncSession,
        redis: Redis,
        user: AuthUser,
        *,
        tournament_id: int,
        workspace_id: int,
        ip_address: str | None,
        user_agent: str | None,
    ) -> StreamRepollRead:
        """Check ownership, meter, journal, commit, then make the next heartbeat due.

        ``workspace_id`` MUST be the workspace the caller's ``stream.update`` was
        checked against: it is both the ownership target and the audit row's scope,
        so the row can never claim authorization in a workspace where it was not.
        """
        # The permission proves the caller may re-poll `workspace_id`, not that this
        # tournament belongs to it — without this check a foreign tournament_id
        # would trigger polling for someone else's tournament.
        owner_workspace_id = await self._tournaments.get_workspace_id(session, tournament_id)
        if owner_workspace_id is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament not found")
        if int(owner_workspace_id) != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tournament does not belong to this workspace",
            )

        # Metered after the checks (a rejected call spends no quota) and before
        # anything durable. Each re-poll costs a Helix round against the 800
        # points/min app bucket SHARED with identity-service's OAuth sign-ins, so
        # draining it breaks logins, not just stream badges.
        await quota.charge(user, "stream.repoll", workspace_id=workspace_id)

        await record_audit(
            session,
            action="stream.repoll",
            source="admin",
            actor=user,
            # Snapshotted: there is no FK on actor_auth_user_id, so a deleted
            # account's row would otherwise resolve to nothing.
            actor_label=user.username,
            workspace_id=workspace_id,
            entity_type="tournament",
            entity_id=tournament_id,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        # record_audit never commits, so the row lands in THIS transaction; the
        # commit after it is part of its contract (``shared/services/audit.py``).
        await session.commit()

        # Redis last, after the durable part is safe: a cleared cursor costs one early
        # tick, whereas a committed audit row for a re-poll that never happened would
        # be a lie in the journal.
        #
        # ponytail: the cursor is global, so this re-polls EVERY active tournament
        # (≤5 Helix requests each); the tick's own `ratelimit_remaining` gate caps it.
        # Upgrade path if operators hammer this: a `stream:poll:due` SET of tournament
        # ids that `run_poll_tick` drains ahead of the interval check.
        await StreamStateStore(redis).clear_last_run()
        return StreamRepollRead(tournament_id=tournament_id)


stream_admin_service = StreamAdminService()
