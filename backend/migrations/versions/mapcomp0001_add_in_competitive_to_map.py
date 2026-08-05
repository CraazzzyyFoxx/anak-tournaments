"""Add in_competitive column to overwatch.map table

Revision ID: mapcomp0001
Revises: rbac0002
Create Date: 2026-08-05 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mapcomp0001"
down_revision: str | None = "rbac0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "map",
        sa.Column("in_competitive", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        schema="overwatch",
    )


def downgrade() -> None:
    op.drop_column("map", "in_competitive", schema="overwatch")
