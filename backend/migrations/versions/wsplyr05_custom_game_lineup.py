"""Add lineup columns to ``balancer.custom_game_player``.

Revision ID: wsplyr05
Revises: wsplyr04
Create Date: 2026-08-25 00:00:00.000000

``is_active`` benches a roster row without removing it; ``roles_json`` is the
ordered role list whose position is the balancer's role priority. Existing rows
default to active with no explicit role order, which is exactly the behaviour
they had before this revision.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "wsplyr05"
down_revision: str | Sequence[str] | None = "wsplyr04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_game_player",
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        schema="balancer",
    )
    op.add_column(
        "custom_game_player",
        sa.Column("roles_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("custom_game_player", "roles_json", schema="balancer")
    op.drop_column("custom_game_player", "is_active", schema="balancer")
