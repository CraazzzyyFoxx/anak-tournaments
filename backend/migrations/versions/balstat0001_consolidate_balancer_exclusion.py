"""consolidate_balancer_exclusion

Fold the standalone exclude_from_balancer/exclude_reason boolean into
balancer_status as a first-class "excluded" value, and let custom balancer
statuses opt into the same pool-exclusion semantics.

- Add registration_status.excludes_from_balancer (workspace-configurable,
  only meaningful for scope='balancer' custom statuses).
- Backfill balancer.registration.balancer_status = 'excluded' for every row
  that currently has exclude_from_balancer = true (they are always paired
  with balancer_status = 'not_in_balancer' today -- every write path enforces
  that -- so this backfill loses no information).
- Drop the now-redundant exclude_from_balancer column and its index; the
  status column carries the same fact.

Revision ID: balstat0001
Revises: pickban02
Create Date: 2026-08-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "balstat0001"
down_revision: str | None = "pickban02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Custom status catalog: workspace-configurable exclusion flag -------
    op.add_column(
        "registration_status",
        sa.Column("excludes_from_balancer", sa.Boolean(), nullable=False, server_default="false"),
        schema="balancer",
    )

    # -- Fold exclude_from_balancer into balancer_status = 'excluded' -------
    op.execute(
        sa.text("""
            UPDATE balancer.registration
            SET balancer_status = 'excluded'
            WHERE exclude_from_balancer
              AND deleted_at IS NULL
        """)
    )

    # -- Drop the now-redundant boolean flag and its index -------------------
    op.drop_index(
        "ix_balancer_registration_tournament_active",
        table_name="registration",
        schema="balancer",
    )
    op.drop_column("registration", "exclude_from_balancer", schema="balancer")


def downgrade() -> None:
    op.add_column(
        "registration",
        sa.Column("exclude_from_balancer", sa.Boolean(), nullable=False, server_default="false"),
        schema="balancer",
    )
    op.execute(
        sa.text("""
            UPDATE balancer.registration
            SET exclude_from_balancer = true,
                balancer_status = 'not_in_balancer'
            WHERE balancer_status = 'excluded'
        """)
    )
    op.create_index(
        "ix_balancer_registration_tournament_active",
        "registration",
        ["tournament_id", "status", "exclude_from_balancer"],
        schema="balancer",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.drop_column("registration_status", "excludes_from_balancer", schema="balancer")
