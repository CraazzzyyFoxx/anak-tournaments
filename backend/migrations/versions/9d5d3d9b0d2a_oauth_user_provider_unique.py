"""Add unique constraint for one provider per auth user

Revision ID: 9d5d3d9b0d2a
Revises: oauth_connections
Create Date: 2026-02-08 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d5d3d9b0d2a"
down_revision: str | None = "oauth_connections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(sa.text("SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_provider'")).fetchone()
    if exists is None:
        op.create_unique_constraint(
            "uq_user_provider",
            "oauth_connections",
            ["auth_user_id", "provider"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(sa.text("SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_provider'")).fetchone()
    if exists is not None:
        op.drop_constraint("uq_user_provider", "oauth_connections", type_="unique")
