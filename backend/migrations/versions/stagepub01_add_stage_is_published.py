"""Add ``tournament.stage.is_published``.

Revision ID: stagepub01
Revises: teamimg0001
Create Date: 2026-08-14 00:00:00.000000

Lets a stage's bracket be generated as a preview (visible to organizers,
unusable by captains) before the stage is actually activated. Unlike
``is_active`` -- a singleton flag that moves to whichever stage is currently
selected and flips back off the moment another stage activates -- this is
sticky: ``activate_stage`` sets it once and it is never cleared again, so an
already-published stage's encounters stay reportable even after a later stage
becomes the active one.

Backfill: every stage that already has encounters, or is already active/
completed, was "live" under the pre-preview world where generation and
usability were the same moment -- it must not retroactively become a hidden
preview for existing tournaments.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "stagepub01"
down_revision: str | Sequence[str] | None = "teamimg0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stage",
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="false"),
        schema="tournament",
    )
    op.execute(
        """
        UPDATE tournament.stage AS s
        SET is_published = true
        WHERE s.is_active
           OR s.is_completed
           OR EXISTS (
                SELECT 1 FROM tournament.encounter AS e WHERE e.stage_id = s.id
           )
        """
    )


def downgrade() -> None:
    op.drop_column("stage", "is_published", schema="tournament")
