"""Add ``players.social_account.display_name``.

Revision ID: socdn01
Revises: mixpick01
Create Date: 2026-10-23 00:00:00.000000

The provider's display name for handles that are opaque ids (Steam's persona
name next to the stored account id). identity-service fills it: on OAuth link,
on an account's creation / id change (``steam_account_changed``) and daily.

``players.social_account`` is read on every profile render, so take
``lock_timeout`` rather than queueing readers behind an ACCESS EXCLUSIVE wait.
A nullable ADD COLUMN without a default is metadata-only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "socdn01"
down_revision: str | Sequence[str] | None = "mixpick01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("SET LOCAL lock_timeout = '3s'"))
    op.add_column(
        "social_account",
        sa.Column("display_name", sa.String(length=255), nullable=True),
        schema="players",
    )


def downgrade() -> None:
    op.execute(sa.text("SET LOCAL lock_timeout = '3s'"))
    op.drop_column("social_account", "display_name", schema="players")
