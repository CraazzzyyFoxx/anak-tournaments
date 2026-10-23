"""VALORANT: its ``catalog.discipline`` row.

Revision ID: valorant01
Revises: mixdraft02
Create Date: 2026-10-23 00:00:00.000000

Roles, stat definitions and event types are projected from the module at startup; VALORANT has no collector, so no
``Settings`` row. The downgrade removes the row, which a database that already holds VALORANT data refuses (foreign
keys): that data is never dropped silently.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "valorant01"
down_revision: str | Sequence[str] | None = "mixdraft02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "INSERT INTO catalog.discipline (code, name) VALUES ('valorant', 'VALORANT') ON CONFLICT (code) DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM catalog.discipline WHERE code = 'valorant'")
