from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

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
from shared.services.scrim_scope import is_scrim_container
from src import models
from src.services.computation.jobs import request_standings_recalculation
from src.services.tournament.realtime_commit import register_tournament_realtime_update


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
        await request_standings_recalculation(session, tournament_id)
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


async def enqueue_registration_approved(
    session: AsyncSession,
    registration: models.BalancerRegistration,
) -> None:
    workspace_id = await get_registration_workspace_id(session, registration.tournament_id)
    await enqueue_outbox_event(
        session,
        RegistrationApprovedEvent(
            tournament_id=registration.tournament_id,
            workspace_id=workspace_id,
            registration_id=registration.id,
            user_id=await get_registration_player_id(session, registration),
            battle_tag=registration.battle_tag,
            source_service="tournament-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.registration.approved",
    )
    register_tournament_realtime_update(session, registration.tournament_id, "registration_changed")


async def enqueue_registration_rejected(
    session: AsyncSession,
    registration: models.BalancerRegistration,
) -> None:
    workspace_id = await get_registration_workspace_id(session, registration.tournament_id)
    await enqueue_outbox_event(
        session,
        RegistrationRejectedEvent(
            tournament_id=registration.tournament_id,
            workspace_id=workspace_id,
            registration_id=registration.id,
            user_id=await get_registration_player_id(session, registration),
            battle_tag=registration.battle_tag,
            source_service="tournament-service",
        ),
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key="tournament.registration.rejected",
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
