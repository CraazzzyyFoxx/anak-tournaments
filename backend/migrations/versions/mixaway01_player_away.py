"""A mix player can step away: ``mix.player.away``.

Revision ID: mixaway01
Revises: mixlive01
Create Date: 2026-10-21 00:00:00.000000

An away player keeps their row, roles and must-play mark, but no balance, lobby split or rotation seats them until they
are back (spec §7.4). Every round recorded meanwhile writes them as a ``busy`` round member, which rotation already
skips, so away time is neither a game played nor one sat out. Set and cleared by the player or a host; never by itself.

Deploy is a no-op: every existing row is present (``false``). No index: read only with the mix's roster.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixaway01"
down_revision: str | Sequence[str] | None = "mixlive01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("player", sa.Column("away", sa.Boolean(), server_default="false", nullable=False), schema="mix")


def downgrade() -> None:
    op.drop_column("player", "away", schema="mix")
