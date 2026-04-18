"""Auto-generate next Swiss round when all encounters in a stage item finish.

Called from recalculation.py after standings are rebuilt so that
Stage.is_completed flags and encounter statuses are already up-to-date.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from loguru import logger
from shared.core import enums
from shared.messaging.config import SWISS_NEXT_ROUND_QUEUE
from shared.observability import publish_message
from shared.schemas.events import SwissNextRoundEvent
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src import models


async def enqueue_swiss_next_rounds(
    session: AsyncSession,
    tournament_id: int,
    *,
    broker: Any | None = None,
) -> list[SwissNextRoundEvent]:
    """Detect Swiss stage items where all current-round encounters are completed
    and queue next-round generation for each.

    Safe to call multiple times — only enqueues when there is at least one
    completed encounter and zero open/pending ones for the item.
    """
    result = await session.execute(
        sa.select(models.Stage)
        .where(
            models.Stage.tournament_id == tournament_id,
            models.Stage.stage_type == enums.StageType.SWISS,
            models.Stage.is_active == True,  # noqa: E712
            models.Stage.is_completed == False,  # noqa: E712
        )
        .options(selectinload(models.Stage.items))
    )
    swiss_stages = result.scalars().all()
    if not swiss_stages:
        return []

    stage_ids = [s.id for s in swiss_stages]

    counts_result = await session.execute(
        sa.select(
            models.Encounter.stage_id,
            models.Encounter.stage_item_id,
            sa.func.count(models.Encounter.id).label("total"),
            sa.func.sum(
                sa.case(
                    (models.Encounter.status == enums.EncounterStatus.COMPLETED, 1),
                    else_=0,
                )
            ).label("completed"),
        )
        .where(models.Encounter.stage_id.in_(stage_ids))
        .group_by(models.Encounter.stage_id, models.Encounter.stage_item_id)
    )

    # Build a lookup: (stage_id, stage_item_id) → (total, completed)
    counts: dict[tuple[int, int | None], tuple[int, int]] = {}
    for row in counts_result:
        counts[(row.stage_id, row.stage_item_id)] = (
            int(row.total or 0),
            int(row.completed or 0),
        )

    events: list[SwissNextRoundEvent] = []
    for stage in swiss_stages:
        items = stage.items or []
        if items:
            for item in items:
                total, completed = counts.get((stage.id, item.id), (0, 0))
                if total > 0 and total == completed:
                    event = SwissNextRoundEvent(
                        stage_id=stage.id,
                        stage_item_id=item.id,
                        tournament_id=tournament_id,
                    )
                    events.append(event)
        else:
            # Ungrouped Swiss stage (no items)
            total, completed = counts.get((stage.id, None), (0, 0))
            if total > 0 and total == completed:
                event = SwissNextRoundEvent(
                    stage_id=stage.id,
                    stage_item_id=None,
                    tournament_id=tournament_id,
                )
                events.append(event)

    if not events:
        return []

    if broker is None:
        logger.warning(
            "swiss_auto_round: no broker available, skipping enqueue",
            tournament_id=tournament_id,
        )
        return []

    for event in events:
        try:
            await publish_message(
                broker,
                event.model_dump(),
                SWISS_NEXT_ROUND_QUEUE,
                logger=logger.bind(
                    stage_id=event.stage_id,
                    stage_item_id=event.stage_item_id,
                    tournament_id=tournament_id,
                ),
            )
            logger.info(
                "Enqueued swiss next round",
                stage_id=event.stage_id,
                stage_item_id=event.stage_item_id,
                tournament_id=tournament_id,
            )
        except Exception:
            logger.exception(
                "Failed to enqueue swiss next round",
                stage_id=event.stage_id,
                stage_item_id=event.stage_item_id,
            )

    return events
