"""Rolling-origin time-series splits over tournaments.

Tournaments are ordered by **start date** (``coalesce(start_date, created_at)``,
id as tie-break). Numeric id is NOT a chronology proxy in this database:
tournament 62 started 2025-07-19 while 61 started 2026-03-14, so id-ordered
splits silently trained on the future. For each cutoff fold the split returns
``(train_ids, val_id, test_id)`` where ``train`` is everything that started
before the validation tournament.
"""

from __future__ import annotations

import typing
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src import models
from src.core.workspace import workspace_scope_filter

__all__ = (
    "TimeSeriesSplit",
    "tournament_ids_up_to",
)


@dataclass(frozen=True)
class TimeSeriesSplit:
    """One fold of the rolling-origin split.

    ``train_ids`` is non-empty; ``val_id`` and ``test_id`` may be ``None`` for
    the early folds (when no future tournaments exist).
    """

    train_ids: tuple[int, ...]
    val_id: int | None
    test_id: int | None

    @classmethod
    def from_ids(cls, ids: typing.Sequence[int], *, test_id: int) -> TimeSeriesSplit:
        """Build a single split with the latest non-test id as validation.

        ``ids`` MUST already be chronologically ordered (the contract of
        :func:`tournament_ids_up_to`); their numeric values are opaque labels.
        Sorting them here would re-impose id-as-time and reintroduce the very
        future-leak this module exists to prevent.
        """
        ordered = [int(i) for i in ids if int(i) != int(test_id)]
        if not ordered:
            return cls(train_ids=(), val_id=None, test_id=int(test_id))
        val_id = ordered[-1]
        train_ids = tuple(ordered[:-1])
        return cls(train_ids=train_ids, val_id=val_id, test_id=int(test_id))


async def tournament_ids_up_to(
    session: AsyncSession,
    cutoff_tournament_id: int,
    *,
    workspace_id: int | None = None,
    workspace_ids: typing.Sequence[int] | None = None,
) -> list[int]:
    """Return ids of tournaments that started on/before the cutoff, in start order.

    Chronology is ``(coalesce(start_date, created_at), id)`` — see the module
    docstring for why numeric id must not order this list. An unknown cutoff id
    yields ``[]`` rather than a silently mis-anchored window.
    """
    chrono = sa.func.coalesce(models.Tournament.start_date, models.Tournament.created_at)
    cutoff_key = (
        await session.execute(
            sa.select(chrono, models.Tournament.id).where(models.Tournament.id == cutoff_tournament_id)
        )
    ).one_or_none()
    if cutoff_key is None:
        return []
    query = (
        sa.select(models.Tournament.id)
        .where(
            sa.tuple_(chrono, models.Tournament.id) <= sa.tuple_(*cutoff_key),
            models.Tournament.id >= 1,
            # Hidden tournaments are containers, not seasons. The per-workspace
            # scrim container (docs/plans/2026-08-12-scrim-rooms.md) holds no
            # ranked roster data, so admitting it here would insert a data-less
            # fold boundary into the rolling-origin split.
            models.Tournament.is_hidden.is_(False),
            *workspace_scope_filter(workspace_id, workspace_ids),
        )
        .order_by(chrono, models.Tournament.id)
    )
    result = await session.execute(query)
    return [int(row[0]) for row in result.all()]
