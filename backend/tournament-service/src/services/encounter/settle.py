"""What an encounter turning CONFIRMED owes the rest of the tournament.

Four paths confirm an encounter -- the captains' series report, an organizer's
result, an agreed game claim (or an admin lobby game) finishing the card, and
a game correction -- and all of them owe the same three things: the bracket
advances, the standings are recalculated, and a Challonge-linked match is
pushed. They live here once so a path cannot forget one of them (the games
path did, and a Bo3 decided by claims left the winner out of the next round).

The first two run inside the caller's transaction (:func:`settle_confirmed`);
the push needs the result committed, so the caller runs it afterwards
(:func:`push_confirmed_to_challonge`).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core import http_status as status
from shared.core.enums import StageType
from shared.core.errors import ApiExc
from shared.core.errors import BaseAPIException as HTTPException
from shared.models.encounter.encounter import Encounter
from shared.models.tournament.bracket_encounter import BracketEncounter
from shared.models.tournament.stage import Stage
from shared.services.bracket.advancement import AdvanceOutcome
from shared.services.challonge_refs import resolve_encounter_challonge
from shared.services.encounter.participants import active_teams
from src.services.notifications.lifecycle import advance_and_announce
from src.services.tournament.events import enqueue_tournament_recalculation

__all__ = ("push_confirmed_to_challonge", "settle_confirmed")

#: Stage types where an encounter MUST produce one team per advancing place: a
#: shared place would leave the advancement edges unfired and the bracket
#: silently stuck (D42).
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


async def push_confirmed_to_challonge(session: AsyncSession, encounter_id: int) -> None:
    """Push a committed result to Challonge when the encounter is linked to a match."""
    if (await resolve_encounter_challonge(session, [encounter_id])).get(encounter_id) is None:
        return
    # Not imported at module scope: the exporter is a different vertical, only
    # reached for a linked encounter, and every result flow would otherwise
    # depend on the whole Challonge stack loading.
    from src.services.challonge.sync import sync_service  # noqa: PLC0415

    await sync_service.auto_push_on_confirm(session, encounter_id)


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
