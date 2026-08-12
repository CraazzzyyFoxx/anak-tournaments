"""drop two dead indexes on matches.statistics

``ix_match_statistics_round`` and ``ix_match_statistics_hero_id`` are unused. On
production, over the whole lifetime of the counters, they served 1 and 34 index
scans while costing 172 MB each; every other index on the table is in the
thousands-to-millions range. Both lead on a low-cardinality column, so the
planner has no reason to pick them, and every access pattern that involves those
columns is already served by a composite index that is actually used
(``ix_match_statistics_match_user_round``, ``ix_match_statistics_user_round_name``,
``ix_match_statistics_user_hero_r0``).

Dropping them returns 344 MB and removes two index writes from every INSERT into
the hottest table in the schema (26M rows and growing).

``hero_id`` keeps its foreign key without a backing index: heroes are static
reference data and nothing in the codebase deletes one, so no ``ON DELETE
CASCADE`` fan-out depends on that lookup.

Dropped CONCURRENTLY (via autocommit_block) so it never blocks writes on the
large statistics table.

Revision ID: statidx001
Revises: gcsu0001
Create Date: 2026-08-03 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "statidx001"
down_revision: str | None = "gcsu0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEAD_INDEXES: tuple[tuple[str, str], ...] = (
    ("ix_match_statistics_round", "round"),
    ("ix_match_statistics_hero_id", "hero_id"),
)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _column in _DEAD_INDEXES:
            op.drop_index(
                name,
                table_name="statistics",
                schema="matches",
                postgresql_concurrently=True,
                if_exists=True,
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, column in _DEAD_INDEXES:
            op.create_index(
                name,
                "statistics",
                [column],
                schema="matches",
                unique=False,
                postgresql_concurrently=True,
                if_not_exists=True,
            )
