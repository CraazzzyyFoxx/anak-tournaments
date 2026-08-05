"""Drop draft_session.team_size

The scalar the roster shape replaced. Every reader and writer is gone: a draft's
size is now resolved from ``tournament.roster_slots_json`` -> the workspace
default -> the built-in shape, and ``draft_session.rounds`` is derived from it.
Keeping the column would leave a second, silently divergent answer to "how big is
a team here" — the mirroring this feature exists to remove.

``rounds`` stays: it is per-session state (the pick grid is built from it) rather
than a duplicate of the shape, and it is written once at creation from
``RosterShape.draft_rounds``.

Revision ID: roster0002
Revises: roster0001
Create Date: 2026-08-05 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "roster0002"
down_revision: str | None = "roster0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("draft_session", "team_size", schema="balancer")


def downgrade() -> None:
    op.add_column(
        "draft_session",
        sa.Column("team_size", sa.Integer(), server_default="5", nullable=False),
        schema="balancer",
    )
    # Every pre-feature session had rounds == team_size - 1 by construction, so
    # the column is reconstructible without data loss.
    op.execute("UPDATE balancer.draft_session SET team_size = rounds + 1")
