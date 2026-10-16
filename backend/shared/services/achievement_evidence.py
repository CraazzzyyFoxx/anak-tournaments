"""Transaction-bound evidence for achievement references and dependency arrays."""

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from shared import models
from shared.services.stats_evidence import capture_stats_evidence, owner_scopes, stage_stats_evidence


async def reserve_reference_ids(session: AsyncSession, model, count: int) -> list[int]:
    """Allocate real sequence ids so creation has an observed absent-before state."""
    if not 1 <= count <= 100:
        raise ValueError("achievement reference batches must contain 1..100 owners")
    with session.no_autoflush:
        return list(
            await session.scalars(
                sa.select(sa.func.nextval(sa.func.pg_get_serial_sequence(model.__table__.fullname, "id"))).select_from(
                    sa.func.generate_series(1, count)
                )
            )
        )


async def lock_achievement_rules(session: AsyncSession, rule_ids) -> int | None:
    """Lock creation/cascade parents in id order; return a common audit workspace."""
    with session.no_autoflush:
        workspaces = set(
            await session.scalars(
                sa.select(models.AchievementRule.workspace_id)
                .where(models.AchievementRule.id.in_(rule_ids))
                .order_by(models.AchievementRule.id)
                .with_for_update()
            )
        )
    return next(iter(workspaces)) if len(workspaces) == 1 else None


@asynccontextmanager
async def achievement_reference_change(
    session: AsyncSession,
    *,
    kind: str,
    ids: Sequence[int],
    workspace_id: int | None,
) -> AsyncIterator[None]:
    """The caller locks the creation parent; capture locks existing owners."""
    scopes = [scope for row_id in ids for scope in owner_scopes(kind, (row_id,))]
    before = await capture_stats_evidence(session, scopes=scopes)
    yield
    await session.flush()
    after = await capture_stats_evidence(session, scopes=scopes)
    if before != after:
        await stage_stats_evidence(
            session,
            operation="stats.reference_update",
            before=before,
            after=after,
            workspace_id=workspace_id,
            entity_type=f"achievement_{kind}",
            entity_id=ids[0] if len(ids) == 1 else None,
        )
