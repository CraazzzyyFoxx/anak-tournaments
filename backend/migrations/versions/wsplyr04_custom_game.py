"""Add ``balancer.custom_game`` and ``balancer.custom_game_player``.

Revision ID: wsplyr04
Revises: wsplyr03
Create Date: 2026-08-24 00:00:00.000000

Pickup games are not tournaments: no tournament_id, no BalancerBalance.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "wsplyr04"
down_revision: str | Sequence[str] | None = "wsplyr03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "custom_game",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("host_user_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="draft", nullable=False),
        sa.Column("config_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("outcome_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["host_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_custom_game_workspace_id"),
        "custom_game",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_custom_game_host_user_id"),
        "custom_game",
        ["host_user_id"],
        unique=False,
        schema="balancer",
    )

    op.create_table(
        "custom_game_player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("custom_game_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_player_id", sa.BigInteger(), nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("team_index", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["custom_game_id"], ["balancer.custom_game.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_player_id"], ["balancer.workspace_player.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("custom_game_id", "workspace_player_id", name="uq_custom_game_player"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_custom_game_player_custom_game_id"),
        "custom_game_player",
        ["custom_game_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_custom_game_player_workspace_player_id"),
        "custom_game_player",
        ["workspace_player_id"],
        unique=False,
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_balancer_custom_game_player_workspace_player_id"),
        table_name="custom_game_player",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_custom_game_player_custom_game_id"),
        table_name="custom_game_player",
        schema="balancer",
    )
    op.drop_table("custom_game_player", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_custom_game_host_user_id"),
        table_name="custom_game",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_custom_game_workspace_id"),
        table_name="custom_game",
        schema="balancer",
    )
    op.drop_table("custom_game", schema="balancer")
