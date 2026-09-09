"""Fetch one ORM page and its matching total.

The page and the total are two statements again. The single-statement version
asked Postgres for ``COUNT(DISTINCT pk) OVER ()`` and Postgres answers
``FeatureNotSupportedError: DISTINCT is not implemented for window functions``
-- every list endpoint that routed through here 500'd in production. SQLite,
which the tests run on, accepts the same SQL, so nothing below the deploy could
have caught it.

The ``DISTINCT`` was not decoration: these queries carry eager-load joins that
fan a single entity across several rows (hence ``unique()``), so a plain
``COUNT(*) OVER ()`` would report the join's row count as the total.

``ponytail:`` one round trip is recoverable if it ever measures --
``dense_rank() OVER (ORDER BY pk) + dense_rank() OVER (ORDER BY pk DESC) - 1``
is the distinct count of the whole filtered set, is exact under fan-out, and is
plain Postgres. It was not worth taking that on while the endpoint was down.
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
    ``pk`` and ``page`` are kept in the signature for the callers' sake and for
    the upgrade path in the module docstring; neither changes the answer now.
    """
    total = int(await session.scalar(total_query) or 0)
    if only_count:
        return [], total

    rows = (await session.execute(query)).unique().scalars().all()
    return rows, total
