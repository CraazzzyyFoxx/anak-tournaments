"""Resolve encounter/standing stage identity to ``(stage_id, stage_item_id)``."""

from __future__ import annotations

from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models.tournament.stage import Stage, StageItem

__all__ = (
    "StageRefs",
    "resolve_stage_refs_from_group",
    "resolve_stage_refs_from_inputs",
)


@dataclass(frozen=True)
class StageRefs:
    """Canonical encounter/standing stage identity."""

    stage_id: int | None
    stage_item_id: int | None


async def _pick_default_stage_item(
    session: AsyncSession,
    stage_id: int,
    hint_name: str | None = None,
) -> int | None:
    items = (
        (
            await session.execute(
                sa.select(StageItem)
                .where(StageItem.stage_id == stage_id)
                .order_by(StageItem.order.asc(), StageItem.id.asc())
            )
        )
        .scalars()
        .all()
    )
    if not items:
        return None
    if hint_name:
        normalized = hint_name.strip().lower()
        for item in items:
            if item.name.strip().lower() == normalized:
                return item.id
    return items[0].id


async def resolve_stage_refs_from_group(
    session: AsyncSession,
    *,
    tournament_id: int,
    stage_id: int | None = None,
    stage_item_id: int | None = None,
) -> StageRefs:
    """Resolve stage/stage_item ids. Prefer explicit ids, else the tournament's first stage."""
    if stage_id is not None:
        if stage_item_id is None:
            stage_item_id = await _pick_default_stage_item(session, stage_id)
        return StageRefs(stage_id=stage_id, stage_item_id=stage_item_id)

    first_stage_id = (
        await session.execute(
            sa.select(Stage.id).where(Stage.tournament_id == tournament_id).order_by(Stage.order.asc(), Stage.id.asc())
        )
    ).scalar_one_or_none()
    if first_stage_id is None:
        return StageRefs(stage_id=None, stage_item_id=None)
    return StageRefs(
        stage_id=first_stage_id,
        stage_item_id=await _pick_default_stage_item(session, first_stage_id),
    )


async def resolve_stage_refs_from_inputs(
    session: AsyncSession,
    *,
    tournament_id: int,
    stage_id: int | None,
    stage_item_id: int | None,
) -> StageRefs:
    """Admin-flow resolver: prefers stage_item_id if given."""
    if stage_item_id is not None:
        item = await session.get(StageItem, stage_item_id)
        if item is not None and item.stage_id:
            return StageRefs(stage_id=item.stage_id, stage_item_id=item.id)
    return await resolve_stage_refs_from_group(
        session,
        tournament_id=tournament_id,
        stage_id=stage_id,
        stage_item_id=stage_item_id,
    )
