"""Mix captain draft: the mix's team formation and pick clock, and the host's defaults per game (spec §4.3).

Revision ID: mixdraft01
Revises: mixban02
Create Date: 2026-10-22 00:00:02.000000

Pure expand: two columns with defaults (``balance`` -- today's behaviour -- and 30 s) and one JSONB map (``{}``).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "mixdraft01"
down_revision: str | Sequence[str] | None = "mixban02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "custom_game",
        sa.Column("team_formation", sa.String(16), nullable=False, server_default="balance"),
        schema="mix",
    )
    op.create_check_constraint(
        "ck_custom_game_team_formation", "custom_game", "team_formation IN ('balance', 'draft')", schema="mix"
    )
    op.add_column(
        "custom_game",
        sa.Column("draft_pick_seconds", sa.Integer(), nullable=False, server_default="30"),
        schema="mix",
    )
    op.create_check_constraint(
        "ck_custom_game_draft_pick_seconds", "custom_game", "draft_pick_seconds BETWEEN 10 AND 600", schema="mix"
    )
    op.add_column(
        "user_config",
        sa.Column("formation_defaults", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("user_config", "formation_defaults", schema="balancer")
    op.drop_constraint("ck_custom_game_draft_pick_seconds", "custom_game", schema="mix", type_="check")
    op.drop_column("custom_game", "draft_pick_seconds", schema="mix")
    op.drop_constraint("ck_custom_game_team_formation", "custom_game", schema="mix", type_="check")
    op.drop_column("custom_game", "team_formation", schema="mix")
