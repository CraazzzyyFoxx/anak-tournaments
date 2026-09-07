"""Add ``tournament.tournament.cover_image_url`` and ``logo_url``.

Revision ID: tcover01
Revises: lateoff01
Create Date: 2026-09-03 00:00:00.000000

Organizers can now attach a cover/banner and a logo to a tournament (issue #95).
Both are S3 public URLs under ``avatars/tournaments/{id}/{cover,logo}/`` -- two
sub-prefixes rather than one, because an avatar upload clears its prefix before
writing, so a shared prefix would make uploading one image delete the other.

Nullable with no default, exactly like ``tournament.team.image_url``
(``teamimg0001``): a tournament without an image renders no image at all, so
NULL is the meaningful state rather than a placeholder path.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "tcover01"
down_revision: str | Sequence[str] | None = "lateoff01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tournament", sa.Column("cover_image_url", sa.String(), nullable=True), schema="tournament")
    op.add_column("tournament", sa.Column("logo_url", sa.String(), nullable=True), schema="tournament")


def downgrade() -> None:
    op.drop_column("tournament", "logo_url", schema="tournament")
    op.drop_column("tournament", "cover_image_url", schema="tournament")
