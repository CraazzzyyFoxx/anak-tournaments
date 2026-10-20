"""What an encounter turning CONFIRMED owes the rest of the tournament.

Four paths confirm an encounter -- the captains' series report, an organizer's
result, an agreed game claim (or an admin lobby game) finishing the card, and
a game correction -- and all of them owe the same three things: the bracket
advances, the standings are recalculated, and a Challonge-linked match is
pushed. They live here once so a path cannot forget one of them.

The first two run inside the caller's transaction (:func:`settle_confirmed`).
The push rides it too, as an outbox row (:func:`enqueue_challonge_push`) the
``tournament_challonge_push`` consumer turns into the Challonge call; every
result write that leaves the encounter confirmed enqueues one, corrections
included, so it is not part of the once-per-confirmation settlement.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.enums import StageType
from shared.core.errors import ApiExc
from shared.core.errors import BaseAPIException as HTTPException
from shared.messaging.config import TOURNAMENT_CHALLONGE_PUSH_QUEUE, TOURNAMENT_EVENTS_EXCHANGE
from shared.messaging.outbox import enqueue_outbox_event
from shared.models.encounter.encounter import Encounter
from shared.models.platform.outbox import EventOutbox
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.stage import Stage
from shared.schemas.events import ChallongePushRequestedEvent
from shared.services.challonge_refs import resolve_encounter_challonge
from shared.services.encounter.participants import active_teams
from src.services.bracket.advancement import AdvanceOutcome
from src.services.notifications.lifecycle import advance_and_announce
from src.services.tournament.events import enqueue_tournament_recalculation

__all__ = ("enqueue_challonge_push", "settle_confirmed")

#: Stage types where an encounter MUST produce one team per advancing place: a
#: shared place would leave the advancement edges unfired and the bracket
#: silently stuck.
_NO_DRAW_STAGE_TYPES = frozenset({StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION})


async def settle_confirmed(session: AsyncSession, encounter: Encounter, *, channel: bool = True) -> AdvanceOutcome:
    """Advance the bracket, queue the standings, refuse a result that strands the bracket.

    An elimination encounter whose standing leaves a linked place without
    exactly one team (a drawn series) raises 400 ``bracket_tie``; the caller's
    rollback then leaves the encounter as it was. Does not commit.
    """
    outcome = await advance_and_announce(session, encounter, channel=channel)
    if await _strands_bracket(session, encounter, outcome):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=[
                ApiExc(
                    code="bracket_tie",
                    msg=(
                        "An elimination-bracket match cannot be completed with a drawn score -- "
                        "a winner is required to advance the bracket"
                    ),
                )
            ],
        )
    await enqueue_tournament_recalculation(session, encounter.tournament_id)
    return outcome


async def enqueue_challonge_push(session: AsyncSession, encounter: Encounter) -> None:
    """Stage the Challonge push of this result version, when the encounter is linked to a match. Does not commit.

    Call it last before the commit: the event carries ``encounter.result_version``, and the consumer drops a push
    whose version no longer matches.
    """
    if (await resolve_encounter_challonge(session, [encounter.id])).get(encounter.id) is None:
        return
    event = ChallongePushRequestedEvent(
        tournament_id=encounter.tournament_id,
        encounter_id=encounter.id,
        result_version=encounter.result_version,
        source_service="tournament-service",
    )
    # A game recorded on an encounter somebody else decided (admin, series claim, import) leaves its result and
    # version as they were: that version's push is already queued, and ``event_id`` is unique.
    if await session.scalar(sa.select(EventOutbox.id).where(EventOutbox.event_id == event.event_id)) is not None:
        return
    await enqueue_outbox_event(
        session,
        event,
        exchange=TOURNAMENT_EVENTS_EXCHANGE,
        routing_key=TOURNAMENT_CHALLONGE_PUSH_QUEUE.routing_key,
    )


async def _strands_bracket(session: AsyncSession, encounter: Encounter, outcome: AdvanceOutcome) -> bool:
    """An elimination standing that leaves a place shared, or a linked place empty.

    ``outcome.blocked_positions`` only knows about linked places, and a Grand
    Final that ends level has no link left to block (its Reset is dropped), so
    the shared place is read off the seats as well.
    """
    stage_type = await session.scalar(
        sa.select(Stage.stage_type)
        .join(BracketEncounter, BracketEncounter.stage_id == Stage.id)
        .where(BracketEncounter.encounter_id == encounter.id)
    )
    if stage_type not in _NO_DRAW_STAGE_TYPES:
        return False
    places = [seat.placement for seat in await active_teams(session, encounter.id) if seat.placement is not None]
    return bool(outcome.blocked_positions) or len(places) != len(set(places))
