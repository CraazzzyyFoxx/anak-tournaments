"""Add ``is_flex`` to ``balancer.custom_game_player``.

Revision ID: mixflex01
Revises: cohost01
Create Date: 2026-08-27 00:00:00.000000

A flex row is equally happy in every role it has an active rank for -- the
mix_balancer backend already understands ``Player.is_flex`` (see
``domain/balancer/backends/mix_balancer.py:priority_for_role``), this column
just gives a lineup row somewhere to store the host's choice. Existing rows
default to ``false``, i.e. ranked by their own role order, exactly the
behaviour they had before this revision.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixflex01"
down_revision: str | Sequence[str] | None = "cohost01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_game_player",
        sa.Column("is_flex", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("custom_game_player", "is_flex", schema="balancer")
