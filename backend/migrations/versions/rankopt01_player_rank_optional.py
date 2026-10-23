"""A tournament player's rank may be unspecified: ``tournament.player.rank`` becomes nullable.

Revision ID: rankopt01
Revises: socdn01
Create Date: 2026-10-23 00:00:00.000000

NULL now means "rank not specified" (1v1 duels, tournaments that never collect ranks); a specified rank is >= 1.
Every writer used to store ``0`` for an unranked member, so the upgrade turns those ``0`` rows into NULL in
``tournament.player`` and in its snapshot mirror ``encounter.team_member.rank`` (already nullable).

The downgrade writes ``0`` back for every NULL in both tables and makes ``tournament.player.rank`` NOT NULL again.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "rankopt01"
down_revision: str | Sequence[str] | None = "socdn01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("player", "rank", existing_type=sa.Integer(), nullable=True, schema="tournament")
    op.execute("UPDATE tournament.player SET rank = NULL WHERE rank = 0")
    op.execute("UPDATE encounter.team_member SET rank = NULL WHERE rank = 0")


def downgrade() -> None:
    op.execute("UPDATE encounter.team_member SET rank = 0 WHERE rank IS NULL")
    op.execute("UPDATE tournament.player SET rank = 0 WHERE rank IS NULL")
    op.alter_column("player", "rank", existing_type=sa.Integer(), nullable=False, schema="tournament")
