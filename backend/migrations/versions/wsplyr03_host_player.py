"""Add ``balancer.host_player`` and ``balancer.host_player_rank``.

Revision ID: wsplyr03
Revises: wsplyr02
Create Date: 2026-08-24 00:00:00.000000

Host pool membership is independent of the host rank book. Removing a
player from the pool must not delete ``host_player_rank`` rows.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsplyr03"
down_revision: str | Sequence[str] | None = "wsplyr02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "host_player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("host_user_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_player_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["host_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_player_id"], ["balancer.workspace_player.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id", "host_user_id", "workspace_player_id", name="uq_host_player"
        ),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_host_player_workspace_id"),
        "host_player",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_host_player_host_user_id"),
        "host_player",
        ["host_user_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_host_player_workspace_player_id"),
        "host_player",
        ["workspace_player_id"],
        unique=False,
        schema="balancer",
    )

    op.create_table(
        "host_player_rank",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("host_user_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_player_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("rank_value", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["host_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_player_id"], ["balancer.workspace_player.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "host_user_id", "workspace_player_id", "role", name="uq_host_player_rank"
        ),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_host_player_rank_host_user_id"),
        "host_player_rank",
        ["host_user_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_host_player_rank_workspace_player_id"),
        "host_player_rank",
        ["workspace_player_id"],
        unique=False,
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_balancer_host_player_rank_workspace_player_id"),
        table_name="host_player_rank",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_host_player_rank_host_user_id"),
        table_name="host_player_rank",
        schema="balancer",
    )
    op.drop_table("host_player_rank", schema="balancer")
    op.drop_index(
        op.f("ix_balancer_host_player_workspace_player_id"),
        table_name="host_player",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_host_player_host_user_id"),
        table_name="host_player",
        schema="balancer",
    )
    op.drop_index(
        op.f("ix_balancer_host_player_workspace_id"),
        table_name="host_player",
        schema="balancer",
    )
    op.drop_table("host_player", schema="balancer")
