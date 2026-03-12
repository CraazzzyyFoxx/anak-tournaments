"""Add balancer schema

Revision ID: 2b1f6c7d9e10
Revises: 1f4f0e9d8c2b
Create Date: 2026-03-12 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2b1f6c7d9e10"
down_revision: str | None = "1f4f0e9d8c2b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS balancer")

    op.create_table(
        "tournament_sheet",
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("sheet_id", sa.String(length=255), nullable=False),
        sa.Column("gid", sa.String(length=64), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("header_row_json", sa.JSON(), nullable=True),
        sa.Column("column_mapping_json", sa.JSON(), nullable=True),
        sa.Column("role_mapping_json", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.String(length=32), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_balancer_tournament_sheet_tournament"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_tournament_sheet_tournament_id",
        "tournament_sheet",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )

    op.create_table(
        "application",
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_sheet_id", sa.BigInteger(), nullable=False),
        sa.Column("battle_tag", sa.String(length=255), nullable=False),
        sa.Column("battle_tag_normalized", sa.String(length=255), nullable=False),
        sa.Column("smurf_tags_json", sa.JSON(), nullable=True),
        sa.Column("twitch_nick", sa.String(length=255), nullable=True),
        sa.Column("discord_nick", sa.String(length=255), nullable=True),
        sa.Column("stream_pov", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("last_tournament_text", sa.Text(), nullable=True),
        sa.Column("primary_role", sa.String(length=64), nullable=True),
        sa.Column("additional_roles_json", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("raw_row_json", sa.JSON(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_sheet_id"], ["balancer.tournament_sheet.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "battle_tag_normalized", name="uq_balancer_application_tournament_tag"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_application_tournament_id",
        "application",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_application_tournament_sheet_id",
        "application",
        ["tournament_sheet_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_application_battle_tag_normalized",
        "application",
        ["battle_tag_normalized"],
        unique=False,
        schema="balancer",
    )

    op.create_table(
        "player",
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("application_id", sa.BigInteger(), nullable=False),
        sa.Column("battle_tag", sa.String(length=255), nullable=False),
        sa.Column("battle_tag_normalized", sa.String(length=255), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("primary_role", sa.String(length=32), nullable=True),
        sa.Column("secondary_roles_json", sa.JSON(), nullable=True),
        sa.Column("division_number", sa.Integer(), nullable=True),
        sa.Column("rank_value", sa.Integer(), nullable=True),
        sa.Column("is_in_pool", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("admin_notes", sa.Text(), nullable=True),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["application_id"], ["balancer.application.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("application_id", name="uq_balancer_player_application"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_player_tournament_id",
        "player",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_player_application_id",
        "player",
        ["application_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_player_battle_tag_normalized",
        "player",
        ["battle_tag_normalized"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_player_user_id",
        "player",
        ["user_id"],
        unique=False,
        schema="balancer",
    )

    op.create_table(
        "balance",
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("saved_by", sa.BigInteger(), nullable=True),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("export_status", sa.String(length=32), nullable=True),
        sa.Column("export_error", sa.Text(), nullable=True),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["saved_by"], ["auth_user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", name="uq_balancer_balance_tournament"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_balance_tournament_id",
        "balance",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )

    op.create_table(
        "team",
        sa.Column("balance_id", sa.BigInteger(), nullable=False),
        sa.Column("exported_team_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("balancer_name", sa.String(length=255), nullable=False),
        sa.Column("captain_battle_tag", sa.String(length=255), nullable=True),
        sa.Column("avg_sr", sa.Float(), nullable=False),
        sa.Column("total_sr", sa.Integer(), nullable=False),
        sa.Column("roster_json", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["balance_id"], ["balancer.balance.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exported_team_id"], ["team.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_team_balance_id",
        "team",
        ["balance_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_team_exported_team_id",
        "team",
        ["exported_team_id"],
        unique=False,
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_index("ix_balancer_team_exported_team_id", table_name="team", schema="balancer")
    op.drop_index("ix_balancer_team_balance_id", table_name="team", schema="balancer")
    op.drop_table("team", schema="balancer")

    op.drop_index("ix_balancer_balance_tournament_id", table_name="balance", schema="balancer")
    op.drop_table("balance", schema="balancer")

    op.drop_index("ix_balancer_player_user_id", table_name="player", schema="balancer")
    op.drop_index("ix_balancer_player_battle_tag_normalized", table_name="player", schema="balancer")
    op.drop_index("ix_balancer_player_application_id", table_name="player", schema="balancer")
    op.drop_index("ix_balancer_player_tournament_id", table_name="player", schema="balancer")
    op.drop_table("player", schema="balancer")

    op.drop_index(
        "ix_balancer_application_battle_tag_normalized",
        table_name="application",
        schema="balancer",
    )
    op.drop_index("ix_balancer_application_tournament_sheet_id", table_name="application", schema="balancer")
    op.drop_index("ix_balancer_application_tournament_id", table_name="application", schema="balancer")
    op.drop_table("application", schema="balancer")

    op.drop_index("ix_balancer_tournament_sheet_tournament_id", table_name="tournament_sheet", schema="balancer")
    op.drop_table("tournament_sheet", schema="balancer")

    op.execute("DROP SCHEMA IF EXISTS balancer")
