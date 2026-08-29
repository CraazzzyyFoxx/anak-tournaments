"""Expand pickup-mix storage with normalized relations.

Revision ID: mix3nf01
Revises: mixflex01
Create Date: 2026-08-29 00:00:00.000000

The old columns stay readable until mix3nf02 backfills every row and mix3nf03
contracts the schema during the coordinated maintenance window.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "mix3nf01"
down_revision: str | Sequence[str] | None = "mixflex01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("custom_game", sa.Column("points_per_win", sa.Integer(), nullable=True), schema="balancer")
    op.add_column(
        "custom_game",
        sa.Column("balancer_config_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "custom_game",
        sa.Column("balancer_config_version", sa.Integer(), server_default="1", nullable=False),
        schema="balancer",
    )
    op.add_column(
        "custom_game",
        sa.Column("balance_result_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "custom_game",
        sa.Column("balance_result_version", sa.Integer(), server_default="1", nullable=False),
        schema="balancer",
    )

    op.add_column("custom_game_player", sa.Column("participation", sa.String(16), nullable=True), schema="balancer")
    op.add_column(
        "custom_game_player",
        sa.Column("role_selection_mode", sa.String(16), nullable=True),
        schema="balancer",
    )

    op.create_table(
        "custom_game_co_host",
        sa.Column("custom_game_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_member_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["custom_game_id"], ["balancer.custom_game.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_member_id"], ["workspace_member.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("custom_game_id", "workspace_member_id"),
        schema="balancer",
    )
    op.create_index(
        "ix_custom_game_co_host_workspace_member_id",
        "custom_game_co_host",
        ["workspace_member_id"],
        schema="balancer",
    )
    op.create_table(
        "custom_game_player_role",
        sa.Column("custom_game_player_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.CheckConstraint("priority > 0", name="ck_custom_game_player_role_priority"),
        sa.ForeignKeyConstraint(
            ["custom_game_player_id"], ["balancer.custom_game_player.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("custom_game_player_id", "role"),
        sa.UniqueConstraint(
            "custom_game_player_id", "priority", name="uq_custom_game_player_role_priority"
        ),
        schema="balancer",
    )
    op.create_table(
        "custom_game_team_name",
        sa.Column("custom_game_id", sa.BigInteger(), nullable=False),
        sa.Column("team_index", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.CheckConstraint("team_index BETWEEN 0 AND 7", name="ck_custom_game_team_name_index"),
        sa.ForeignKeyConstraint(["custom_game_id"], ["balancer.custom_game.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("custom_game_id", "team_index"),
        schema="balancer",
    )
    op.create_table(
        "custom_game_role_slot",
        sa.Column("custom_game_id", sa.BigInteger(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("slot_count", sa.Integer(), nullable=False),
        sa.CheckConstraint("slot_count > 0", name="ck_custom_game_role_slot_count"),
        sa.ForeignKeyConstraint(["custom_game_id"], ["balancer.custom_game.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("custom_game_id", "role"),
        schema="balancer",
    )

    op.add_column("team", sa.Column("match_id", sa.BigInteger(), nullable=True), schema="casual")
    op.add_column("team", sa.Column("side", sa.String(8), nullable=True), schema="casual")
    op.add_column("team", sa.Column("score", sa.Integer(), nullable=True), schema="casual")
    op.create_index("ix_casual_team_match_id", "team", ["match_id"], schema="casual")
    op.create_foreign_key(
        "fk_casual_team_match_id",
        "team",
        "match",
        ["match_id"],
        ["id"],
        source_schema="casual",
        referent_schema="casual",
        ondelete="CASCADE",
    )

    op.add_column("player", sa.Column("display_name_snapshot", sa.String(255), nullable=True), schema="casual")
    # Dropped by discovery, not by name: ``casual01`` created this FK unnamed, so
    # the only name it has is whatever Postgres generated. Hardcoding that guess
    # would fail the migration on any database where it differs.
    op.execute(
        """
        DO $$
        DECLARE
            constraint_name text;
        BEGIN
            SELECT con.conname INTO constraint_name
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'casual'
              AND rel.relname = 'player'
              AND con.contype = 'f'
              AND con.conkey = ARRAY[
                  (SELECT attnum FROM pg_attribute
                   WHERE attrelid = rel.oid AND attname = 'workspace_member_id')
              ]::smallint[];
            IF constraint_name IS NULL THEN
                RAISE EXCEPTION 'mix3nf01: casual.player has no workspace_member_id foreign key to replace';
            END IF;
            EXECUTE format('ALTER TABLE casual.player DROP CONSTRAINT %I', constraint_name);
        END $$;
        """
    )
    op.alter_column("player", "workspace_member_id", nullable=True, schema="casual")
    op.create_foreign_key(
        "fk_casual_player_workspace_member_id",
        "player",
        "workspace_member",
        ["workspace_member_id"],
        ["id"],
        source_schema="casual",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_casual_player_workspace_member_id", "player", schema="casual", type_="foreignkey"
    )
    op.alter_column("player", "workspace_member_id", nullable=False, schema="casual")
    op.create_foreign_key(
        "player_workspace_member_id_fkey",
        "player",
        "workspace_member",
        ["workspace_member_id"],
        ["id"],
        source_schema="casual",
        ondelete="CASCADE",
    )
    op.drop_column("player", "display_name_snapshot", schema="casual")
    op.drop_constraint("fk_casual_team_match_id", "team", schema="casual", type_="foreignkey")
    op.drop_index("ix_casual_team_match_id", table_name="team", schema="casual")
    op.drop_column("team", "score", schema="casual")
    op.drop_column("team", "side", schema="casual")
    op.drop_column("team", "match_id", schema="casual")

    op.drop_table("custom_game_role_slot", schema="balancer")
    op.drop_table("custom_game_team_name", schema="balancer")
    op.drop_table("custom_game_player_role", schema="balancer")
    op.drop_index(
        "ix_custom_game_co_host_workspace_member_id",
        table_name="custom_game_co_host",
        schema="balancer",
    )
    op.drop_table("custom_game_co_host", schema="balancer")
    op.drop_column("custom_game_player", "role_selection_mode", schema="balancer")
    op.drop_column("custom_game_player", "participation", schema="balancer")
    op.drop_column("custom_game", "balance_result_version", schema="balancer")
    op.drop_column("custom_game", "balance_result_json", schema="balancer")
    op.drop_column("custom_game", "balancer_config_version", schema="balancer")
    op.drop_column("custom_game", "balancer_config_json", schema="balancer")
    op.drop_column("custom_game", "points_per_win", schema="balancer")
