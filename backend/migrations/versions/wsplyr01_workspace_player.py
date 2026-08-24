"""Add ``balancer.workspace_player`` and ``balancer.workspace_player_rank``.

Revision ID: wsplyr01
Revises: dropgrp01
Create Date: 2026-08-24 00:00:00.000000

Workspace-scoped player identity. ``player_id`` is nullable so ghosts can exist
without a ``players.user`` row. Soft-hide is ``hidden_at``; the two partial
uniques apply only to visible rows.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsplyr01"
down_revision: str | Sequence[str] | None = "dropgrp01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("battle_tag", sa.String(length=255), nullable=True),
        sa.Column("battle_tag_normalized", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("player_id", sa.BigInteger(), nullable=True),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=True),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["players.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_workspace_player_workspace_id"),
        "workspace_player",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "uq_workspace_player_tag_active",
        "workspace_player",
        ["workspace_id", "battle_tag_normalized"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("battle_tag_normalized IS NOT NULL AND hidden_at IS NULL"),
    )
    op.create_index(
        "uq_workspace_player_player_active",
        "workspace_player",
        ["workspace_id", "player_id"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("player_id IS NOT NULL AND hidden_at IS NULL"),
    )

    op.create_table(
        "workspace_player_rank",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_player_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_player_id"], ["balancer.workspace_player.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_player_id", "role", name="uq_workspace_player_rank"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_workspace_player_rank_workspace_player_id"),
        "workspace_player_rank",
        ["workspace_player_id"],
        unique=False,
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_balancer_workspace_player_rank_workspace_player_id"),
        table_name="workspace_player_rank",
        schema="balancer",
    )
    op.drop_table("workspace_player_rank", schema="balancer")
    op.drop_index(
        "uq_workspace_player_player_active",
        table_name="workspace_player",
        schema="balancer",
    )
    op.drop_index(
        "uq_workspace_player_tag_active",
        table_name="workspace_player",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_workspace_player_workspace_id"),
        table_name="workspace_player",
        schema="balancer",
    )
    op.drop_table("workspace_player", schema="balancer")
