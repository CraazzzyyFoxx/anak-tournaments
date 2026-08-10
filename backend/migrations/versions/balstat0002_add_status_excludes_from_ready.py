"""add_status_excludes_from_ready

Lets a workspace-configured custom balancer status also block a registration
from counting as "ready" (Ready lane / Ready tab / run-balance eligibility),
independent of whether it excludes the registration from the pool entirely.

Mirrors `excludes_from_balancer` (balstat0001): only meaningful for
scope='balancer' custom statuses; builtin statuses keep this fixed (always
False) in BUILTIN_STATUS_META, not admin-editable via this column.

Revision ID: balstat0002
Revises: balstat0001
Create Date: 2026-08-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "balstat0002"
down_revision: str | None = "balstat0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "registration_status",
        sa.Column("excludes_from_ready", sa.Boolean(), nullable=False, server_default="false"),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("registration_status", "excludes_from_ready", schema="balancer")
