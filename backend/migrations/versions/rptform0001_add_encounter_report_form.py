"""configurable captain match-report form

Revision ID: rptform0001
Revises: mtchlog001
Create Date: 2026-08-04 12:00:00.000000

Makes the captain match-report form configurable per tournament:

- ``tournament.encounter_report_form`` — one row per tournament holding
  ``built_in_fields_json`` (``closeness``/``map_codes``/``comment`` ->
  ``{enabled, required}``) and ``custom_fields_json`` (ordered text-field
  definitions). No row means "all defaults"; the row is created lazily on the
  first organizer save.
- ``tournament.encounter_captain_report.comment`` — the new built-in free-form
  note from the reporting captain.
- ``tournament.encounter_captain_report.custom_fields_json`` — the captain's
  answers to the organizer's custom text fields, keyed by definition key.
- ``tournament.encounter_captain_report.closeness`` becomes nullable, because a
  tournament may disable the match-quality field entirely. The existing
  ``CHECK (closeness BETWEEN 1 AND 10)`` is left alone — a SQL CHECK passes on
  NULL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "rptform0001"
down_revision: str | Sequence[str] | None = "mtchlog001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── encounter_report_form ─────────────────────────────────────────────
    op.create_table(
        "encounter_report_form",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("built_in_fields_json", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("custom_fields_json", sa.JSON(), server_default="[]", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tournament_id", name="uq_encounter_report_form_tournament"),
        schema="tournament",
    )
    # ``ix_<schema>_<table>_<column>`` — the name SQLAlchemy derives from
    # ``index=True``, so a future autogenerate diff stays clean.
    op.create_index(
        "ix_tournament_encounter_report_form_tournament_id",
        "encounter_report_form",
        ["tournament_id"],
        schema="tournament",
    )

    # ── encounter_captain_report: comment + custom answers ────────────────
    op.add_column(
        "encounter_captain_report",
        sa.Column("comment", sa.Text(), nullable=True),
        schema="tournament",
    )
    op.add_column(
        "encounter_captain_report",
        sa.Column("custom_fields_json", sa.JSON(), server_default="{}", nullable=False),
        schema="tournament",
    )
    op.alter_column(
        "encounter_captain_report",
        "closeness",
        existing_type=sa.Integer(),
        nullable=True,
        schema="tournament",
    )


def downgrade() -> None:
    # Reports filed while the field was disabled carry no rating; a neutral 6
    # keeps them inside the surviving CHECK instead of failing the NOT NULL.
    op.execute(
        """
        UPDATE tournament.encounter_captain_report
           SET closeness = 6
         WHERE closeness IS NULL
        """
    )
    op.alter_column(
        "encounter_captain_report",
        "closeness",
        existing_type=sa.Integer(),
        nullable=False,
        schema="tournament",
    )
    op.drop_column("encounter_captain_report", "custom_fields_json", schema="tournament")
    op.drop_column("encounter_captain_report", "comment", schema="tournament")
    op.drop_index(
        "ix_tournament_encounter_report_form_tournament_id",
        table_name="encounter_report_form",
        schema="tournament",
    )
    op.drop_table("encounter_report_form", schema="tournament")
