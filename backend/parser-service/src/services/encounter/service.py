"""Encounter context used by Workshop map-pool validation."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models


async def bracket_positions(
    session: AsyncSession,
    encounter_ids: Sequence[int],
) -> dict[int, tuple[int | None, int]]:
    rows = await session.execute(
        sa.select(
            models.BracketEncounter.encounter_id,
            models.BracketEncounter.stage_id,
            models.BracketEncounter.round,
        ).where(models.BracketEncounter.encounter_id.in_(encounter_ids))
    )
    return {encounter_id: (stage_id, round_) for encounter_id, stage_id, round_ in rows}
