"""Drop tournament.number — replaced by (start_date, id) chronology and name-based identity.

Revision ID: tnum0001
Revises: divgrid0004
Create Date: 2026-07-28
"""

import sqlalchemy as sa
from alembic import op

revision = "tnum0001"
down_revision = "divgrid0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("tournament", "number", schema="tournament")


def downgrade() -> None:
    # Data is not restorable — the column comes back empty.
    op.add_column(
        "tournament",
        sa.Column("number", sa.Integer(), nullable=True),
        schema="tournament",
    )
