"""make division-grid default references nullable

``workspace.default_division_grid_version_id`` and
``tournament.division_grid_version_id`` were altered to NOT NULL by
``a1b2c3d4e5f6`` even though both FKs use ``ON DELETE SET NULL`` and the ORM
models declare them ``nullable=True``. That contradiction breaks FK SET NULL and
any explicit clearing of the workspace default (e.g. force-deleting a grid).
Restore the intended nullability so the DB matches the models.

Revision ID: divgrid0004
Revises: divgrid0003
Create Date: 2026-07-24 22:45:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "divgrid0004"
down_revision: str | Sequence[str] | None = "divgrid0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "workspace",
        "default_division_grid_version_id",
        existing_type=sa.BigInteger(),
        nullable=True,
    )
    op.alter_column(
        "tournament",
        "division_grid_version_id",
        existing_type=sa.BigInteger(),
        nullable=True,
        schema="tournament",
    )


def downgrade() -> None:
    op.alter_column(
        "tournament",
        "division_grid_version_id",
        existing_type=sa.BigInteger(),
        nullable=False,
        schema="tournament",
    )
    op.alter_column(
        "workspace",
        "default_division_grid_version_id",
        existing_type=sa.BigInteger(),
        nullable=False,
    )
