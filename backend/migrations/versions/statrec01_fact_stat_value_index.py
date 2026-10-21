"""``stats.fact``: a partial ``(stat_id, value)`` index over player totals for the statistics records.

Revision ID: statrec01
Revises: deadlock01
Create Date: 2026-10-21 00:00:00.000000

The single-map records read the highest player total of five stats; without this index that sorts every total of
those stats (~376k rows on the dev dataset, ~1 s). The index holds player totals only (segment 0, no entity, a
member), so it builds from the ~3.7M total rows, not the whole table, and a record is one backward index probe.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "statrec01"
down_revision: str | Sequence[str] | None = "deadlock01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_fact_stat_value_total ON stats.fact (stat_id, value) "
        "WHERE segment = 0 AND entity_id IS NULL AND workspace_member_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS stats.ix_fact_stat_value_total")
