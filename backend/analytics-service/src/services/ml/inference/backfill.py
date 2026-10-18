"""Historical backfill — runs the inference runner over the tournaments of a range."""

from __future__ import annotations

import logging
import typing

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core.analytics_exports import supports_analytics
from src.core.workspace import workspace_filter

from .runner import run_for_tournament

logger = logging.getLogger(__name__)

__all__ = ("backfill_range",)


async def backfill_range(
    session: AsyncSession,
    *,
    from_tournament_id: int,
    to_tournament_id: int,
    workspace_id: int | None = None,
    model_kinds: typing.Sequence[str] | None = None,
    discipline: str | None = None,
) -> dict[int, dict[str, int]]:
    """Run the inference pipeline for every analytics-supported tournament in ``[from, to]``.

    Only tournaments that exist, are not hidden containers, lie in ``workspace_id`` when given, belong to
    ``discipline`` when given and whose discipline declares an analytics module are visited; each one is served by its
    own discipline's module. Returns ``{tournament_id: {kind: rows}}``. Each tournament is committed
    independently — interrupting the run leaves the DB in a consistent state.
    """
    if from_tournament_id > to_tournament_id:
        return {}
    tournaments = await session.execute(
        sa.select(models.Tournament.id, models.Tournament.discipline)
        .where(
            models.Tournament.id.between(int(from_tournament_id), int(to_tournament_id)),
            models.Tournament.is_hidden.is_(False),
            *workspace_filter(workspace_id),
        )
        .order_by(models.Tournament.id)
    )
    results: dict[int, dict[str, int]] = {}
    for tid, code in tournaments.all():
        if (discipline is not None and code != discipline) or not supports_analytics(code):
            continue
        logger.info("Backfilling tournament_id=%d", tid)
        results[int(tid)] = await run_for_tournament(
            session,
            int(tid),
            workspace_id=workspace_id,
            model_kinds=model_kinds,
        )
    return results
