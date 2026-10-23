"""Swiss qualification / elimination thresholds and the best-of of the matches that decide them.

Revision ID: swissth01
Revises: rankopt01
Create Date: 2026-10-23 00:00:00.000000

``tournament.stage`` gains ``swiss_qualify_wins`` / ``swiss_eliminate_losses`` (a team that reached either is paired
no more) and ``best_of_swiss_qualify`` / ``best_of_swiss_eliminate`` (the series length of a match that can send one
of its teams through / home). All nullable: NULL is "off", which is every existing stage.

``tournament.standing`` gains ``swiss_status`` (``qualified`` / ``eliminated``), written by the standings engine.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "swissth01"
down_revision: str | Sequence[str] | None = "rankopt01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STAGE_COLUMNS = ("swiss_qualify_wins", "swiss_eliminate_losses", "best_of_swiss_qualify", "best_of_swiss_eliminate")


def upgrade() -> None:
    for column in _STAGE_COLUMNS:
        op.add_column("stage", sa.Column(column, sa.Integer(), nullable=True), schema="tournament")
        op.create_check_constraint(
            f"ck_stage_{column}", "stage", f"{column} IS NULL OR {column} >= 1", schema="tournament"
        )
    op.add_column("standing", sa.Column("swiss_status", sa.String(16), nullable=True), schema="tournament")
    op.create_check_constraint(
        "ck_standing_swiss_status", "standing", "swiss_status IN ('qualified', 'eliminated')", schema="tournament"
    )


def downgrade() -> None:
    op.drop_constraint("ck_standing_swiss_status", "standing", type_="check", schema="tournament")
    op.drop_column("standing", "swiss_status", schema="tournament")
    for column in reversed(_STAGE_COLUMNS):
        op.drop_constraint(f"ck_stage_{column}", "stage", type_="check", schema="tournament")
        op.drop_column("stage", column, schema="tournament")
