"""Telling captains and organizers that a captain contradiction needs a decision.

Two flows produce the same stalemate — ``map_report`` when the two per-map
claims for one position disagree, ``captain`` when the two FINAL series scores
do. A captain can only re-report, and two captains who disagree once disagree
twice, so somebody with ``match.result`` has to adopt a side — and nobody sits
watching the admin screens for a dispute to appear.

Lives beside the two producers rather than in ``shared.services.notifications``
because it is a tournament-domain decision (which workspace owns the encounter,
which permission marks an organizer), not part of the inbox primitive.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.encounter.encounter import Encounter
from shared.models.encounter.game import EncounterGame
from shared.models.encounter.team import EncounterTeam
from shared.models.identity.user import User
from shared.models.tournament.team import Team
from shared.repository.notification_recipients import NotificationRecipientRepository
from shared.repository.tournament import TournamentRepository
from shared.services.notifications import STAFF_PERMISSION, notify

__all__ = ("notify_dispute",)

_recipients = NotificationRecipientRepository()
_tournaments = TournamentRepository()


async def notify_dispute(
    session: AsyncSession,
    encounter: Encounter,
    *,
    seats: Sequence[EncounterTeam],
    actor_auth_user_id: int | None,
    game: EncounterGame | None = None,
) -> None:
    """Page the organizers who can resolve the dispute; for a per-game one, every captain in the game too.

    ``game=None`` is the series-level dispute: the captains learn the outcome from
    the response they are holding. A per-game contradiction tells every captain,
    not just the opponent — from inside the reconciliation none of them is known
    to be the wrong one. An organizer already told as a captain is skipped, or
    they would read the same event twice, in two voices.

    Never commits — like every ``notify()`` caller, this runs inside the flow's
    own transaction so the rows and the dispute land together or not at all.
    """
    workspace_id = await _tournaments.get_workspace_id(session, encounter.tournament_id)
    captains: list[int] = []
    if game is not None:
        team_ids = [seat.team_id for seat in seats if seat.team_id is not None]
        if team_ids:
            rows = await session.execute(
                sa.select(User.auth_user_id)
                .join(Team, Team.captain_id == User.id)
                .where(Team.id.in_(team_ids), User.auth_user_id.is_not(None))
            )
            captains = [int(value) for value in rows.scalars()]
        for recipient in captains:
            await notify(
                session,
                kind="encounter.report_disputed",
                recipient_auth_user_id=recipient,
                source_workspace_id=workspace_id,
                actor_auth_user_id=actor_auth_user_id,
                payload={
                    "encounter_id": encounter.id,
                    "tournament_id": encounter.tournament_id,
                    "game_id": game.id,
                    "position": game.position,
                    "map_id": game.map_id,
                },
            )
    if workspace_id is None:
        # A tournament with no tenant has no organizers to page.
        return
    # The permission that can END a dispute (adopt a side, set the score); read
    # access would page spectators of the admin panel.
    staff = await _recipients.workspace_staff_auth_user_ids(session, workspace_id, *STAFF_PERMISSION)
    already_told = set(captains)
    # ponytail: the dedupe key is the game (or the series), so once an organizer
    # has been paged about this position they are never paged about it again --
    # including after they reopen it and the captains disagree a second time.
    # Upgrade path is a key that carries the reopen generation, when reopening
    # turns out to be common enough that the silence is felt.
    dedupe_key = f"game:{game.id}" if game is not None else f"series:{encounter.id}"
    for recipient in staff:
        if recipient in already_told:
            continue
        await notify(
            session,
            kind="encounter.dispute_review",
            recipient_auth_user_id=recipient,
            source_workspace_id=workspace_id,
            actor_auth_user_id=actor_auth_user_id,
            dedupe_key=dedupe_key,
            payload={
                "encounter_id": encounter.id,
                "tournament_id": encounter.tournament_id,
                "game_id": None if game is None else game.id,
                # 0 is the series-level sentinel the inbox's ``plural`` selects
                # on; an absent key is not an ICU argument.
                "position": 0 if game is None else game.position,
                "team_names": [seat.name for seat in seats],
            },
        )
