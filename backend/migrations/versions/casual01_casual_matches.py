"""Add ``casual.team``, ``casual.player`` and ``casual.match``.

Revision ID: casual01
Revises: anlcln02
Create Date: 2026-08-26 00:00:00.000000

Frozen history of played casual matches (pickup-mix results, ...), with no
``tournament_id``/``tournament.team`` FK at all -- casual play never touches
the tournament schema. A ``custom_game`` (mix) can record many matches before
it is closed. ``heroclass`` is an existing shared enum type
(``overwatch.hero.type``, ``matches.stat_baselines.role``,
``tournament.player.role``), referenced here rather than recreated.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "casual01"
down_revision: str | Sequence[str] | None = "anlcln02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS casual")

    op.create_table(
        "team",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="casual",
    )
    op.create_index(
        op.f("ix_casual_team_workspace_id"), "team", ["workspace_id"], unique=False, schema="casual"
    )

    op.create_table(
        "player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM("tank", "damage", "support", "flex", name="heroclass", create_type=False),
            nullable=True,
        ),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["casual.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="casual",
    )
    op.create_index(op.f("ix_casual_player_team_id"), "player", ["team_id"], unique=False, schema="casual")
    op.create_index(
        op.f("ix_casual_player_workspace_member_id"),
        "player",
        ["workspace_member_id"],
        unique=False,
        schema="casual",
    )

    op.create_table(
        "match",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("custom_game_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("home_team_id", sa.BigInteger(), nullable=False),
        sa.Column("away_team_id", sa.BigInteger(), nullable=False),
        sa.Column("home_score", sa.Integer(), nullable=False),
        sa.Column("away_score", sa.Integer(), nullable=False),
        sa.Column("map_id", sa.BigInteger(), nullable=True),
        sa.Column("recorded_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["custom_game_id"], ["balancer.custom_game.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["home_team_id"], ["casual.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["away_team_id"], ["casual.team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["map_id"], ["overwatch.map.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recorded_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="casual",
    )
    op.create_index(
        op.f("ix_casual_match_custom_game_id"), "match", ["custom_game_id"], unique=False, schema="casual"
    )
    op.create_index(
        op.f("ix_casual_match_workspace_id"), "match", ["workspace_id"], unique=False, schema="casual"
    )
    op.create_index(op.f("ix_casual_match_map_id"), "match", ["map_id"], unique=False, schema="casual")


def downgrade() -> None:
    op.drop_index(op.f("ix_casual_match_map_id"), table_name="match", schema="casual")
    op.drop_index(op.f("ix_casual_match_workspace_id"), table_name="match", schema="casual")
    op.drop_index(op.f("ix_casual_match_custom_game_id"), table_name="match", schema="casual")
    op.drop_table("match", schema="casual")

    op.drop_index(op.f("ix_casual_player_workspace_member_id"), table_name="player", schema="casual")
    op.drop_index(op.f("ix_casual_player_team_id"), table_name="player", schema="casual")
    op.drop_table("player", schema="casual")

    op.drop_index(op.f("ix_casual_team_workspace_id"), table_name="team", schema="casual")
    op.drop_table("team", schema="casual")

    op.execute("DROP SCHEMA IF EXISTS casual")
