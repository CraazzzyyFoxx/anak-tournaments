"""Which tenant produced a notification, so an operator can retire it.

Revision ID: notif003
Revises: notif002
Create Date: 2026-09-09 00:00:00.000000

``notification.workspace_id`` answers "who is this addressed to" and is set for
``audience='workspace'`` only -- the CHECK constraints from ``notif001`` forbid
it on a personal row. That leaves every system notification (a registration
decision, a team invite, a disputed report) with no tenant at all, so a
workspace operator has no way to name the rows their own tournaments emitted.

``source_workspace_id`` is that missing fact, and a separate column rather than
a relaxation of the CHECKs: the audience semantics stay exactly as they were,
and one row can legitimately be *addressed to one person* while *owned by one
tenant*. Nullable, because a platform-wide announcement genuinely has no source.

The backfill reads the tenant out of what the payload snapshot already carries:
``tournament_id`` for four of the five kinds, ``team_id`` for
``team_invite.answered`` (whose snapshot names no tournament), and the audience
target itself for workspace announcements. Rows a join cannot resolve -- a
tournament since deleted -- keep ``NULL`` and simply do not appear in an
operator list; the inbox they live in is unaffected either way.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "notif003"
down_revision: str | Sequence[str] | None = "notif002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ``~ '^[0-9]+$'`` before the cast: payload_json is operator- and
# producer-written JSONB with no column type behind it, and one non-numeric
# value would abort the whole UPDATE rather than skip its row.
_NUMERIC = "^[0-9]+$"


def upgrade() -> None:
    op.add_column("notification", sa.Column("source_workspace_id", sa.BigInteger(), nullable=True))
    op.create_index(
        "ix_notification_source_workspace_published",
        "notification",
        ["source_workspace_id", sa.text("published_at DESC")],
        postgresql_where=sa.text("source_workspace_id IS NOT NULL"),
    )

    op.execute(
        sa.text(
            """
            UPDATE notification AS n
            SET source_workspace_id = t.workspace_id
            FROM tournament.tournament AS t
            WHERE n.source_workspace_id IS NULL
              AND n.payload_json ->> 'tournament_id' ~ :numeric
              AND t.id = (n.payload_json ->> 'tournament_id')::bigint
            """
        ).bindparams(numeric=_NUMERIC)
    )
    op.execute(
        sa.text(
            """
            UPDATE notification AS n
            SET source_workspace_id = rt.workspace_id
            FROM balancer.registration_team AS rt
            WHERE n.source_workspace_id IS NULL
              AND n.kind = 'team_invite.answered'
              AND n.payload_json ->> 'team_id' ~ :numeric
              AND rt.id = (n.payload_json ->> 'team_id')::bigint
            """
        ).bindparams(numeric=_NUMERIC)
    )
    op.execute(
        sa.text(
            """
            UPDATE notification
            SET source_workspace_id = workspace_id
            WHERE source_workspace_id IS NULL AND audience = 'workspace'
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_notification_source_workspace_published", table_name="notification")
    op.drop_column("notification", "source_workspace_id")
