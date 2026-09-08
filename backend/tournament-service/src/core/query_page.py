"""Fetch one ORM page and its matching total in a single statement.

``COUNT(DISTINCT pk) OVER ()`` is evaluated after WHERE/GROUP BY/HAVING and
before LIMIT/OFFSET, so a non-empty page carries the full filtered total. Empty
pages (``only_count``, OFFSET past the end) fall back to the caller's
``total_query``. SQLAlchemy ``AsyncSession`` is not concurrent-safe, so this
is the replacement for a second sequential COUNT round-trip — not
``asyncio.gather``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

_PAGE_TOTAL = "_page_total"


async def execute_page_with_total(
    session: AsyncSession,
    query: sa.Select[Any],
    total_query: sa.Select[Any],
    *,
    pk: InstrumentedAttribute[Any],
    page: int = 1,
    only_count: bool = False,
) -> tuple[Sequence[Any], int]:
    """Run ``query`` (already filtered/sorted/paginated) and return ``(rows, total)``.

    ``query`` must already carry LIMIT/OFFSET (or ``LIMIT 0`` for ``only_count``).
    The window column is dropped before the entities are returned: callers still
    receive the same ORM instances ``unique().scalars().all()`` used to.
    """
    if only_count:
        total = await session.scalar(total_query)
        return [], int(total or 0)

    paged = query.add_columns(sa.func.count(sa.distinct(pk)).over().label(_PAGE_TOTAL))
    rows = (await session.execute(paged)).unique().all()
    if not rows:
        if page <= 1:
            return [], 0
        total = await session.scalar(total_query)
        return [], int(total or 0)

    return [row[0] for row in rows], int(rows[0]._mapping[_PAGE_TOTAL] or 0)
