"""Mix hero bans: the mix's own preset and its host's default per game (spec §4.3, §8.1).

Revision ID: mixban01
Revises: mixaway01
Create Date: 2026-10-22 00:00:00.000000

Pure expand: one nullable column and one column with a default; NULL / ``{}`` is "no bans", today's behaviour.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "mixban01"
down_revision: str | Sequence[str] | None = "mixaway01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("custom_game", sa.Column("hero_ban_preset", sa.String(64), nullable=True), schema="mix")
    op.add_column(
        "user_config",
        sa.Column("hero_ban_presets", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("user_config", "hero_ban_presets", schema="balancer")
    op.drop_column("custom_game", "hero_ban_preset", schema="mix")
