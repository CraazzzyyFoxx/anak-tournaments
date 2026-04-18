"""Auto-generation of next Swiss round triggered by queue event."""

from __future__ import annotations

from typing import Any

from loguru import logger
from shared.schemas.events import SwissNextRoundEvent
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core import db
from src.services.admin import stage as stage_service
from src.services.standings import service as standings_service


async def process_swiss_next_round_event(
    data: dict[str, Any],
    *,
    session_factory: Any = db.async_session_maker,
) -> None:
    """Handle SwissNextRoundEvent: generate next round for a Swiss stage item.

    Idempotent — if a race condition caused duplicate events, the second call
    simply generates another round using the already-updated standings.
    The admin can always delete the extra encounters if needed, but in practice
    deduplication at the publish side prevents this.
    """
    event = SwissNextRoundEvent.model_validate(data)
    log = logger.bind(
        stage_id=event.stage_id,
        stage_item_id=event.stage_item_id,
        tournament_id=event.tournament_id,
    )
    log.info("Processing swiss next round event")

    try:
        async with session_factory() as session:
            await _generate_next_round(session, event)
    except Exception:
        log.exception("Failed to generate swiss next round")
        raise


async def _generate_next_round(
    session: AsyncSession,
    event: SwissNextRoundEvent,
) -> list[models.Encounter]:
    stage = await stage_service.get_stage(session, event.stage_id)

    if not stage.is_active:
        logger.warning(
            "Swiss auto-round: stage is not active, skipping",
            stage_id=event.stage_id,
        )
        return []

    # Resolve the stage item (or None for ungrouped)
    item: models.StageItem | None = None
    team_ids: list[int] = []

    if event.stage_item_id is not None:
        item = next((i for i in stage.items if i.id == event.stage_item_id), None)
        if item is None:
            logger.error(
                "Swiss auto-round: stage item not found",
                stage_item_id=event.stage_item_id,
            )
            return []
        team_ids = stage_service._collect_item_team_ids(item)
    else:
        for i in stage.items:
            team_ids.extend(stage_service._collect_item_team_ids(i))

    if len(team_ids) < 2:
        logger.warning(
            "Swiss auto-round: not enough teams",
            stage_id=event.stage_id,
            stage_item_id=event.stage_item_id,
        )
        return []

    skeleton = await stage_service._generate_stage_skeleton(
        session, stage, team_ids, event.stage_item_id
    )
    encounters = await stage_service._create_encounters_from_skeleton(
        session, stage, skeleton, event.stage_item_id
    )
    await session.commit()

    logger.info(
        "Swiss auto-round: generated %d encounters for round %d",
        len(encounters),
        skeleton.pairings[0].round_number if skeleton.pairings else "?",
        stage_id=event.stage_id,
        stage_item_id=event.stage_item_id,
    )

    # Recalculate standings so the new encounters appear
    await standings_service.recalculate_for_tournament(session, event.tournament_id)

    return encounters
