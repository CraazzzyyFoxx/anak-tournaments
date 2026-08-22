"""Bench size for team registration.

Revision ID: regteam0002
Revises: regteam0001
Create Date: 2026-08-20 00:00:00.000000

Decision 4 of docs/plans/2026-08-20-team-registration.md: the roster ``RosterShape``
is strict, but an organizer may allow substitutes on top of it. That count lives on
the registration form, not on ``Tournament.roster_slots_json``, because a substitute
occupies no starter slot -- so the shape, and the ``roster_locked_by_teams`` guard
protecting it, are untouched by changing the bench.

``server_default='0'`` makes this a pure expand: every existing form keeps today's
behaviour (no bench), and no code needs to run before the column is readable.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "regteam0002"
down_revision: str | None = "regteam0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration_form",
        sa.Column("max_substitutes", sa.Integer(), nullable=False, server_default="0"),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("registration_form", "max_substitutes", schema="balancer")
