"""Drop legacy ``tournament.group`` and its FK columns.

Revision ID: dropgrp01
Revises: tslug0001
Create Date: 2026-08-24 00:00:00.000000

Every encounter/standing on ``anak_dev`` that still had a group id already
carries ``stage_id``. New writes stopped setting the FKs. The leftover table
and ``challonge_team.group_id`` (no ORM) go with it.

``anak_dev``/prod that ran the v5 chain stay on their stamped revision —
apply this file's SQL directly, do not ``alembic upgrade`` from ``initial_v6``.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "dropgrp01"
down_revision: str | Sequence[str] | None = "tslug0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("encounter_tournament_group_id_fkey", "encounter", schema="tournament", type_="foreignkey")
    op.drop_constraint("standing_group_id_fkey", "standing", schema="tournament", type_="foreignkey")
    op.drop_constraint("challonge_team_group_id_fkey", "challonge_team", schema="tournament", type_="foreignkey")

    op.drop_index("ix_encounter_tournament_group", table_name="encounter", schema="tournament")
    op.drop_index("ix_encounter_tournament_group_id", table_name="encounter", schema="tournament")
    op.drop_index("ix_standing_group_id", table_name="standing", schema="tournament")
    op.drop_index("ix_tournament_challonge_team_group_id", table_name="challonge_team", schema="tournament")

    op.drop_column("encounter", "tournament_group_id", schema="tournament")
    op.drop_column("standing", "group_id", schema="tournament")
    op.drop_column("challonge_team", "group_id", schema="tournament")

    op.drop_table("group", schema="tournament")


def downgrade() -> None:
    op.create_table(
        "group",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("is_groups", sa.Boolean(), nullable=False),
        sa.Column("challonge_id", sa.Integer(), nullable=True),
        sa.Column("challonge_slug", sa.String(), nullable=True),
        sa.Column("stage_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="tournament",
    )
    op.create_index("ix_tournament_group_tournament_id", "group", ["tournament_id"], schema="tournament")

    op.add_column("encounter", sa.Column("tournament_group_id", sa.BigInteger(), nullable=True), schema="tournament")
    op.add_column("standing", sa.Column("group_id", sa.Integer(), nullable=True), schema="tournament")
    op.add_column("challonge_team", sa.Column("group_id", sa.BigInteger(), nullable=True), schema="tournament")

    op.create_foreign_key(
        "encounter_tournament_group_id_fkey",
        "encounter",
        "group",
        ["tournament_group_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "standing_group_id_fkey",
        "standing",
        "group",
        ["group_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "challonge_team_group_id_fkey",
        "challonge_team",
        "group",
        ["group_id"],
        ["id"],
        source_schema="tournament",
        referent_schema="tournament",
        ondelete="CASCADE",
    )
    op.create_index("ix_encounter_tournament_group", "encounter", ["tournament_id", "tournament_group_id"], schema="tournament")
    op.create_index("ix_encounter_tournament_group_id", "encounter", ["tournament_group_id"], schema="tournament")
    op.create_index("ix_standing_group_id", "standing", ["group_id"], schema="tournament")
    op.create_index("ix_tournament_challonge_team_group_id", "challonge_team", ["group_id"], schema="tournament")
