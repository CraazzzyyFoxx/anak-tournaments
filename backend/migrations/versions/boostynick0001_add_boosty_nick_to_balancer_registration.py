"""add boosty_nick to balancer.registration

Revision ID: boostynick0001
Revises: rptform0001
Create Date: 2026-08-04 18:00:00.000000

Adds boosty_nick column to balancer.registration table.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "boostynick0001"
down_revision: str | Sequence[str] | None = "rptform0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration",
        sa.Column("boosty_nick", sa.String(length=255), nullable=True),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("registration", "boosty_nick", schema="balancer")
