"""Add ``tournament.stage_item.advance_count``.

Revision ID: grpadv01
Revises: draftreg1
Create Date: 2026-09-05 00:00:00.000000

Per-group override of ``stage.advance_count``: a stage says "2 advance from each
group", one group says "3 advance from me". Needed whenever groups are unequal
in size or strength -- a 6-team group and a 4-team group advancing the same
count is a different bar in each.

Nullable with no default, and deliberately the same column name as the stage's:
NULL means "inherit the stage's number", which is what every existing group
does, so no backfill and no behaviour change for current tournaments.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "grpadv01"
down_revision: str | Sequence[str] | None = "draftreg1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("stage_item", sa.Column("advance_count", sa.Integer(), nullable=True), schema="tournament")


def downgrade() -> None:
    op.drop_column("stage_item", "advance_count", schema="tournament")
