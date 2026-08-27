"""Add ``must_play`` to ``balancer.custom_game_player``.

Revision ID: mustplay1
Revises: wsgdvrf01
Create Date: 2026-08-26 00:00:00.000000

A mix balance no longer requires the active lineup to divide evenly into
full teams (``runtime._prepare_balance_context``): a leftover player sits out
instead of blocking the run. ``must_play`` lets a host guarantee specific
players a seat regardless of that trimming -- the balancer only reaches into
flagged players if there are more of them than team slots exist. Pure
additive column, ``NOT NULL DEFAULT false`` backfills every existing row with
today's behavior (nobody guaranteed), so there is no ordering hazard.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mustplay1"
down_revision: str | Sequence[str] | None = "wsgdvrf01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_game_player",
        sa.Column("must_play", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("custom_game_player", "must_play", schema="balancer")
