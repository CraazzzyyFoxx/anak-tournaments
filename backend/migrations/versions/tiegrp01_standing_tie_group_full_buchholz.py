"""Add ``tournament.standing.tie_group`` and ``full_buchholz``.

Revision ID: tiegrp01
Revises: grpadv01
Create Date: 2026-09-05 00:00:00.000000

``tie_group`` marks rows no configured tiebreaker could separate: equal values
across rows mean their relative order was assigned, not earned. Stored rather
than derived on read because the row keeps only the TRIMMED Buchholz, so a tie
broken at the untrimmed one cannot be reconstructed after the fact.

``full_buchholz`` is that untrimmed sum. It is a distinct tiebreaker from
``buchholz`` (which holds the median/trimmed value and doubles as the
group-vs-playoff discriminator via ``IS NULL``), and the engine already computes
it -- it was simply thrown away.

Both are nullable with no backfill: they populate on the next recalculation, and
until then read as "not tied" / "unknown", which is what the old rows meant.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "tiegrp01"
down_revision: str | Sequence[str] | None = "grpadv01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("standing", sa.Column("full_buchholz", sa.Float(), nullable=True), schema="tournament")
    op.add_column("standing", sa.Column("tie_group", sa.Integer(), nullable=True), schema="tournament")


def downgrade() -> None:
    op.drop_column("standing", "tie_group", schema="tournament")
    op.drop_column("standing", "full_buchholz", schema="tournament")
