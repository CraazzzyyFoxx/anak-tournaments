"""Per-viewer deletion for the notification inbox.

Revision ID: notif002
Revises: notif001
Create Date: 2026-09-09 00:00:00.000000

"Delete this notification" is a fact about *(row, viewer)*, so it lands on the
mark table beside ``read_at`` rather than as a ``DELETE`` on ``notification``.
Three reasons the row itself must survive:

* ``notification`` is an append-only journal (same contract as ``audit_log``),
  and an announcement is one row shared by everybody -- deleting it because one
  reader dismissed it would remove it from every other inbox.
* ``notification_read`` has no foreign keys on purpose, so a hard delete would
  leave marks pointing at nothing and turn a repeat "was this read" into a
  question the database can no longer answer.
* ``expires_at`` already means "retired for everyone" (the announcement
  operator's delete). Reusing it for a personal dismissal would conflate the
  two audiences.

Nullable with no backfill: ``NULL`` is "not deleted", which is exactly the
state every existing mark is in.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "notif002"
down_revision: str | Sequence[str] | None = "notif001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notification_read",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_read", "deleted_at")
