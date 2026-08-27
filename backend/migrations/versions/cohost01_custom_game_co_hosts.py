"""Add ``co_host_user_ids`` to ``balancer.custom_game``.

Revision ID: cohost01
Revises: mustplay1
Create Date: 2026-08-27 00:00:00.000000

A mix has exactly one ``host_user_id`` and every write (``_require_writer``,
formerly ``_require_host``) used to gate on it alone -- a host who wanted
somebody else to also run the lineup, balance, or record outcomes had no way
to grant that short of a full ``transfer_host`` handoff, which gives up their
own access in the process. This is a second, additive layer: a plain array of
workspace-member user ids, anyone in it writes the mix exactly like the host.
Pure additive column, nullable (no co-hosts is the default for every mix that
exists today), so there is no backfill.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cohost01"
down_revision: str | Sequence[str] | None = "mustplay1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_game",
        sa.Column("co_host_user_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("custom_game", "co_host_user_ids", schema="balancer")
