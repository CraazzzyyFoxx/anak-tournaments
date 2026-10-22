"""Mix hero bans: the preset a started match froze on its lobby (spec §5.1, §8.1).

Revision ID: mixban02
Revises: mixban01
Create Date: 2026-10-22 00:00:01.000000

Pure expand: one nullable column; NULL is "no bans", today's behaviour.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixban02"
down_revision: str | Sequence[str] | None = "mixban01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("lobby", sa.Column("live_ban_preset", sa.String(64), nullable=True), schema="mix")


def downgrade() -> None:
    op.drop_column("lobby", "live_ban_preset", schema="mix")
