"""add attempts counter to log_processing.record

Bounds the stall-recovery loop in ``src/services/match_logs/reaper.py``: the
reaper republishes records the queue dropped, and ``attempts`` (bumped when a
record actually enters processing) is what stops a log that kills the worker
before it can mark itself failed from cycling forever.

Revision ID: logretry0001
Revises: subs0002
Create Date: 2026-08-03 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "logretry0001"
down_revision: str | None = "subs0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "record",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        schema="log_processing",
    )


def downgrade() -> None:
    op.drop_column("record", "attempts", schema="log_processing")
