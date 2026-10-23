"""The replay codes captains entered, read back for the dispute views.

A code lives on ``encounter.game_team.replay_code`` (one per participation per
position); the admin reports list and the public captain-report read both show
them next to the reports an adjudicator is comparing.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.encounter.game import EncounterGame, EncounterGameTeam
from src import schemas

__all__ = ("replay_codes_by_encounter",)


async def replay_codes_by_encounter(
    session: AsyncSession, encounter_ids: Sequence[int]
) -> dict[int, list[schemas.ReplayCodeRead]]:
    """``encounter_id -> its codes`` in play order, then by participation.

    A cancelled position still counts: a series confirmed by the captains'
    reports cancels every position nobody entered as a game, and those rows are
    exactly where the reports' codes sit. A replayed position has a newer row,
    whose code wins. Encounters without a code get no key.
    """
    if not encounter_ids:
        return {}
    rows = await session.execute(
        sa.select(
            EncounterGame.encounter_id,
            EncounterGame.position,
            EncounterGameTeam.encounter_team_id,
            EncounterGameTeam.replay_code,
        )
        .join(EncounterGameTeam, EncounterGameTeam.game_id == EncounterGame.id)
        .where(EncounterGame.encounter_id.in_(encounter_ids), EncounterGameTeam.replay_code.is_not(None))
        .order_by(EncounterGame.id)
    )
    newest = {(encounter_id, position, team_id): code for encounter_id, position, team_id, code in rows.all()}
    codes: dict[int, list[schemas.ReplayCodeRead]] = {}
    for (encounter_id, position, team_id), code in sorted(newest.items()):
        codes.setdefault(encounter_id, []).append(
            schemas.ReplayCodeRead(position=position, encounter_team_id=team_id, code=code)
        )
    return codes
