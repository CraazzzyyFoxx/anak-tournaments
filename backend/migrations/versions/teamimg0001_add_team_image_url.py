"""Add ``tournament.team.image_url``.

Revision ID: teamimg0001
Revises: initial_v6
Create Date: 2026-08-13 00:00:00.000000

Teams can now carry an uploaded image (S3 public URL, same bucket layout as user
avatars: ``avatars/teams/{team_id}/{hash}.{ext}``). Nullable with no default: a
team without an image renders no image at all, so NULL is the meaningful state
rather than a placeholder path.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "teamimg0001"
down_revision: str | Sequence[str] | None = "initial_v6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("team", sa.Column("image_url", sa.String(), nullable=True), schema="tournament")


def downgrade() -> None:
    op.drop_column("team", "image_url", schema="tournament")
