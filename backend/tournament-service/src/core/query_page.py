"""Fetch one ORM page and its matching total.

The page and the total are two statements. A single statement would need
``COUNT(DISTINCT pk) OVER ()``, which Postgres rejects
(``FeatureNotSupportedError: DISTINCT is not implemented for window functions``)
while SQLite, which the tests run on, accepts it -- so only production would fail.

The ``DISTINCT`` is load-bearing: these queries carry eager-load joins that
fan a single entity across several rows (hence ``unique()``), so a plain
``COUNT(*) OVER ()`` would report the join's row count as the total.

``ponytail:`` one round trip is recoverable if it ever measures --
``dense_rank() OVER (ORDER BY pk) + dense_rank() OVER (ORDER BY pk DESC) - 1``
is the distinct count of the whole filtered set, is exact under fan-out, and is
plain Postgres.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute


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
    ``pk`` and ``page`` stay in the signature for the callers' sake and for the
    upgrade path in the module docstring; neither changes the answer.
    """
    total = int(await session.scalar(total_query) or 0)
    if only_count:
        return [], total

    rows = (await session.execute(query)).unique().scalars().all()
    return rows, total
