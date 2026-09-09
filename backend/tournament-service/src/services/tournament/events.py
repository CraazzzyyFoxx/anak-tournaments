from __future__ import annotations

import asyncio
from typing import Any

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from shared.messaging.config import (
    TOURNAMENT_CHANGED_EXCHANGE,
    TOURNAMENT_EVENTS_EXCHANGE,
)
from shared.messaging.outbox import enqueue_outbox_event
from shared.schemas.events import (
    RegistrationApprovedEvent,
    RegistrationRejectedEvent,
    TournamentChangedEvent,
    TournamentChangedReason,
    TournamentStateChangedEvent,
)
from shared.services.encounter import events as shared_encounter_events
from shared.services.notifications import notify, publish_notification_created
from shared.services.scrim_scope import is_scrim_container
from src import models
from src.core.redis import get_realtime_redis
from src.services.computation.jobs import jobs_service
from src.services.tournament.realtime_commit import register_tournament_realtime_update

#: Recipients whose ``notification.created`` nudge is waiting for this
#: transaction to commit. Neither decision function below owns a commit -- their
#: callers do, and one of them approves a whole batch in a loop -- so the signal
#: cannot be sent inline without risking a "your registration was approved" ping
#: for a transaction that then rolls back. ``after_commit`` is where the
#: transaction actually ends, and it is the same hook ``realtime_commit`` already
#: uses to invalidate caches for exactly this reason.
_PENDING_SIGNALS_KEY = "notification_signal_recipients"

#: Tournament names already snapshotted in this transaction, keyed by id.
#: ``bulk_approve_registrations`` decides a whole batch for ONE tournament in a
#: loop, so reading the name per registration is an N+1 that grows with the
#: batch. The session's identity map cannot serve as that cache: it holds clean
#: instances WEAKLY, so a ``session.get`` result is collected between iterations
#: and re-queried every time.
_TOURNAMENT_NAMES_KEY = "notification_tournament_names"

# asyncio keeps only a weak reference to a running task, so an unanchored
# fire-and-forget publish can be collected mid-flight.
_signal_tasks: set[asyncio.Task[Any]] = set()


def _session_info(session: AsyncSession) -> dict[Any, Any] | None:
    """The underlying ``Session.info``, the per-transaction scratch space the
    ``after_commit``/``after_rollback`` listeners below drain."""
    return getattr(getattr(session, "sync_session", None) or session, "info", None)


def _stage_notification_signal(session: AsyncSession, recipient_auth_user_id: int) -> None:
    info = _session_info(session)
    if info is None:
        return
    info.setdefault(_PENDING_SIGNALS_KEY, set()).add(int(recipient_auth_user_id))


async def _tournament_name(session: AsyncSession, tournament_id: int) -> str:
    """The tournament's name for a snapshot, read at most once per transaction.

    Single-column scalar projection, memoized on the session -- see
    ``_TOURNAMENT_NAMES_KEY`` for why the identity map is not the memo.
    """
    info = _session_info(session)
    names: dict[int, str] = info.setdefault(_TOURNAMENT_NAMES_KEY, {}) if info is not None else {}
    if tournament_id not in names:
        names[tournament_id] = (
            await session.scalar(sa.select(models.Tournament.name).where(models.Tournament.id == tournament_id)) or ""
        )
    return names[tournament_id]


@event.listens_for(Session, "after_commit")
def _publish_notification_signals_after_commit(session: Session) -> None:
    # Both scratch keys are per-transaction; a session outlives its transactions.
    session.info.pop(_TOURNAMENT_NAMES_KEY, None)
    recipients: set[int] = session.info.pop(_PENDING_SIGNALS_KEY, set())
    if not recipients:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No loop to publish from; the row is durable, the bell shows it on the
        # inbox's next read.
        return
    for recipient in recipients:
        task = loop.create_task(publish_notification_created(get_realtime_redis(), recipient_auth_user_id=recipient))
        _signal_tasks.add(task)
        task.add_done_callback(_signal_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _drop_notification_signals_after_rollback(session: Session) -> None:
    session.info.pop(_TOURNAMENT_NAMES_KEY, None)
    session.info.pop(_PENDING_SIGNALS_KEY, None)


async def enqueue_tournament_recalculation(
    session: AsyncSession,
    tournament_id: int,
) -> None:
    # A scrim container has nothing to recalculate: every one of its stages is a
    # single ad-hoc room with no stage items, no seeds and no rosters
    # (docs/plans/2026-08-12-scrim-rooms.md §4.1). Recalculating it does not
    # merely waste a job — the elimination branch of the standings builder
    # derives participants from encounters when seeds are absent, so it invents a
    # "1st place" Standing row for every room's two rosterless teams and flips
    # their Stage.is_completed, and it does that for EVERY room in the workspace
    # on every captain report of any one of them.
    #
    # Skipped here, at the only automatic door into the standings queue, rather
    # than no-opped in the worker: a job that is created, delivered and then
    # discarded is a permanent per-report cost that looks like health.
    if not await is_scrim_container(session, tournament_id):
        await jobs_service.request_standings_recalculation(session, tournament_id)
    # The realtime ping still goes out: it is a cache-invalidation notification,
    # not a computation, and a room's participants are legitimate viewers of the
    # container.
    register_tournament_realtime_update(session, tournament_id, "bracket_changed")


async def enqueue_tournament_changed(
    session: AsyncSession,
    tournament_id: int,
    reason: TournamentChangedReason,
) -> None:
    await enqueue_outbox_event(
        session,
        TournamentChangedEvent(
            tournament_id=tournament_id,
            reason=reason,
            source_service="tournament-service",
        ),
        exchange=TOURNAMENT_CHANGED_EXCHANGE,
        routing_key=f"tournament.changed.{tournament_id}",
    )
    register_tournament_realtime_update(session, tournament_id, reason)


async def enqueue_encounter_completed(
    session: AsyncSession,
    encounter: models.Encounter,
) -> None:
    await shared_encounter_events.enqueue_encounter_completed(session, encounter, source_service="tournament-service")


async def get_registration_workspace_id(session: AsyncSession, tournament_id: int) -> int:
    # BalancerRegistration has no denormalized workspace_id column — derive it via
    # the owning tournament (registrations are always tournament-scoped).
    workspace_id = await session.scalar(
        sa.select(models.Tournament.workspace_id).where(models.Tournament.id == tournament_id)
    )
    assert workspace_id is not None, f"Tournament {tournament_id} has no workspace_id"
    return int(workspace_id)


async def get_registration_player_id(
    session: AsyncSession,
    registration: models.BalancerRegistration,
) -> int | None:
    """The registration's domain player id (players.user.id), via its member.

    workspace_member_id is the row's only identity anchor (dbarch02 dropped
    user_id); an explicit scalar query avoids lazy-loading the relationship in
    async code. Registrations without a member have no player identity.
    """
    if registration.workspace_member_id is None:
        return None
    return await session.scalar(
        sa.select(models.WorkspaceMember.player_id).where(models.WorkspaceMember.id == registration.workspace_member_id)
    )


async def _notify_registration_decision(
    session: AsyncSession,
    registration: models.BalancerRegistration,
    player_id: int | None,
    *,
    kind: str,
    workspace_id: int | None,
) -> None:
    """Tell the registrant their entry was decided, and stage their nudge.

    A shadow player -- a real competitor with no site account behind their
    ``players.user`` row -- has no inbox, so there is simply no row. That is not
    an error: the decision itself is about the registration, not the account.

    ``ponytail:`` no de-duplication. A status toggled approved -> rejected ->
    approved notifies three times, because the write is unconditional. The
    upgrade path is a suppression window inside ``notify()`` (skip a repeat of
    the same recipient/kind/entity within N minutes), not a unique index, which
    would also block the legitimate repeat.
    """
    # The admin review paths (`approve_registration`, `reject_registration`,
    # `update_registration_profile`) reach here with a registration loaded by
    # `get_registration_by_id`, whose options already eager-load
    # `workspace_member.player` and `tournament` -- the two rows this used to
    # re-read. Read them off the instance dict rather than the attribute:
    # touching an unloaded relationship on an async session raises instead of
    # lazy-loading, which is why `lifecycle._workspace_id_for` does the same.
    member = registration.__dict__.get("workspace_member")
    player = member.__dict__.get("player") if member is not None else None
    if player is not None:
        recipient = player.auth_user_id
    elif player_id is not None:
        recipient = await session.scalar(sa.select(models.User.auth_user_id).where(models.User.id == player_id))
    else:
        recipient = None
    if recipient is None:
        return
    tournament = registration.__dict__.get("tournament")
    tournament_name = (
        tournament.name if tournament is not None else await _tournament_name(session, registration.tournament_id)
    )
    await notify(
        session,
        kind=kind,
        recipient_auth_user_id=int(recipient),
        # The organizer that owns the tournament, so their operators can find
        # (and retire) the decision rows their own review produced. Passed in
        # rather than re-read: both callers already resolved it for the outbox
        # event above.
        source_workspace_id=workspace_id,
        payload={
            "tournament_id": registration.tournament_id,
            "tournament_name": tournament_name,
            "registration_id": registration.id,
        },
    )
    _stage_notification_signal(session, int(recipient))


async def enqueue_registration_approved(
    session: AsyncSession,
    registration: models.BalancerRegistration,
) -> None:
    workspace_id = await get_registration_workspace_id(session, registration.tournament_id)
    player_id = await get_registration_player_id(session, registration)
    await enqueue_outbox_event(
        session,
        RegistrationApprovedEvent(
            tournament_id=registration.tournament_id,
            workspace_id=workspace_id,
            registration_id=registration.id,
            user_id=player_id,
            battle_tag=registration.battle_tag,
            source_service="tournament-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.registration.approved",
    )
    await _notify_registration_decision(
        session, registration, player_id, kind="registration.approved", workspace_id=workspace_id
    )
    register_tournament_realtime_update(session, registration.tournament_id, "registration_changed")


async def enqueue_registration_rejected(
    session: AsyncSession,
    registration: models.BalancerRegistration,
) -> None:
    workspace_id = await get_registration_workspace_id(session, registration.tournament_id)
    player_id = await get_registration_player_id(session, registration)
    await enqueue_outbox_event(
        session,
        RegistrationRejectedEvent(
            tournament_id=registration.tournament_id,
            workspace_id=workspace_id,
            registration_id=registration.id,
            user_id=player_id,
            battle_tag=registration.battle_tag,
            source_service="tournament-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.registration.rejected",
    )
    await _notify_registration_decision(
        session, registration, player_id, kind="registration.rejected", workspace_id=workspace_id
    )
    register_tournament_realtime_update(session, registration.tournament_id, "registration_changed")


async def enqueue_tournament_state_changed(
    session: AsyncSession,
    tournament: models.Tournament,
    *,
    old_status: str | None,
    new_status: str,
) -> None:
    await enqueue_outbox_event(
        session,
        TournamentStateChangedEvent(
            tournament_id=tournament.id,
            workspace_id=tournament.workspace_id,
            old_status=old_status,
            new_status=new_status,
            source_service="tournament-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.state.changed",
    )
