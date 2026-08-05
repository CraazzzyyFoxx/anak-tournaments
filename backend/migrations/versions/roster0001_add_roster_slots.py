"""Add roster_slots columns to tournament and workspace

Two nullable JSONB columns holding a per-team roster shape
(``{"tank": 1, "dps": 2, "support": 2}``): an override on the tournament and a
default on the workspace.

No backfill. Both columns are NULL for every existing row, and NULL is the
"inherit" signal in ``shared.domain.roster_shape.resolve_roster_shape``
(tournament override -> workspace default -> built-in Overwatch 5v5), so every
existing tournament keeps resolving to today's 1/2/2 shape without a single
UPDATE. A server_default would be actively wrong here: it would make "no
override" indistinguishable from a deliberately configured shape.

JSONB rather than JSON because admin tournament listings filter on the shape,
and Postgres ``json`` has no operator class for that without a cast.

Purely additive. ``balancer.draft_session.team_size`` — the scalar this shape
replaces — is deliberately left in place: the balancer still reads and writes it.
Dropping it gets its own revision, landed together with the code change that
stops using the column.

Revision ID: roster0001
Revises: catalias0001
Create Date: 2026-08-05 14:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "roster0001"
down_revision: str | None = "catalias0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tournament",
        sa.Column("roster_slots_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="tournament",
    )
    op.add_column(
        "workspace",
        sa.Column("default_roster_slots_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace", "default_roster_slots_json")
    op.drop_column("tournament", "roster_slots_json", schema="tournament")
