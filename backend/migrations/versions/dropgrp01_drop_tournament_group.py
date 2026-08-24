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


def _drop_fks_on_column(schema: str, table: str, column: str) -> None:
    """Drop every FK on ``schema.table.column``, whatever Postgres named it.

    ``initial_v6`` created these FKs unnamed; v5 used ``*_fkey``. A live DB
    may have either, neither, or a leftover name from the public→tournament
    schema move.
    """
    op.execute(
        f"""
        DO $$
        DECLARE r record;
        BEGIN
          FOR r IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
            WHERE c.contype = 'f'
              AND n.nspname = '{schema}'
              AND t.relname = '{table}'
              AND a.attname = '{column}'
          LOOP
            EXECUTE format('ALTER TABLE {schema}.{table} DROP CONSTRAINT %I', r.conname);
          END LOOP;
        END $$;
        """
    )


def upgrade() -> None:
    _drop_fks_on_column("tournament", "encounter", "tournament_group_id")
    _drop_fks_on_column("tournament", "standing", "group_id")
    _drop_fks_on_column("tournament", "challonge_team", "group_id")

    # v5 names and the ``op.f("ix_tournament_*")`` names from initial_v6.
    for name in (
        "ix_encounter_tournament_group",
        "ix_encounter_tournament_group_id",
        "ix_tournament_encounter_tournament_group_id",
        "ix_standing_group_id",
        "ix_tournament_standing_group_id",
        "ix_tournament_challonge_team_group_id",
    ):
        op.execute(f"DROP INDEX IF EXISTS tournament.{name}")

    op.execute(
        """
        DO $$
        BEGIN
          IF to_regclass('tournament.encounter') IS NOT NULL THEN
            ALTER TABLE tournament.encounter DROP COLUMN IF EXISTS tournament_group_id;
          END IF;
          IF to_regclass('tournament.standing') IS NOT NULL THEN
            ALTER TABLE tournament.standing DROP COLUMN IF EXISTS group_id;
          END IF;
          IF to_regclass('tournament.challonge_team') IS NOT NULL THEN
            ALTER TABLE tournament.challonge_team DROP COLUMN IF EXISTS group_id;
          END IF;
        END $$;
        """
    )

    op.execute("DROP TABLE IF EXISTS tournament.group")


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
