"""Notification inbox and announcement tables.

Revision ID: notif001
Revises: wstier001
Create Date: 2026-09-07 00:00:00.000000

Part of the notifications design (``docs/plans/2026-09-07-notifications.md``),
Task 1 of the implementation plan.

Both tables land in the **default schema**, beside ``audit_log`` and
``event_outbox``. The design sketched a ``platform`` schema; no such schema
exists in this database and the sibling journals it would have joined live in
``public`` with no ``schema=`` kwarg at all, so creating one for two tables
would be a second convention rather than a home for an existing one (ruling R1).

No foreign keys, matching those same siblings: an append-only journal outlives
the business rows it describes, and a cascade from a deleted team or account
would delete exactly the history the table exists to keep. ``payload_json``
carries the render snapshot instead of a join.

``published_at`` is not a duplicate of ``created_at``: it is schedulable, so an
announcement can be authored now and become visible later. Reads filter on
``published_at``; ``created_at`` stays the immutable insert time.

The second index is partial (``WHERE audience <> 'user'``). Per-user rows are
the bulk of the table and are never fetched through the ``audience`` prefix --
the announcement read wants only ``workspace``/``global`` rows -- so excluding
them keeps that index small enough to stay resident.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "notif001"
down_revision: str | Sequence[str] | None = "wstier001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("audience", sa.String(length=16), nullable=False),
        sa.Column("recipient_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("actor_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "audience <> 'user' OR recipient_auth_user_id IS NOT NULL",
            name="ck_notification_user_has_recipient",
        ),
        sa.CheckConstraint(
            "audience = 'user' OR recipient_auth_user_id IS NULL",
            name="ck_notification_non_user_has_no_recipient",
        ),
        sa.CheckConstraint(
            "audience <> 'workspace' OR workspace_id IS NOT NULL",
            name="ck_notification_workspace_has_workspace",
        ),
        sa.CheckConstraint(
            "audience = 'workspace' OR workspace_id IS NULL",
            name="ck_notification_non_workspace_has_no_workspace",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notification_recipient_published",
        "notification",
        ["recipient_auth_user_id", sa.literal_column("published_at DESC")],
        unique=False,
    )
    op.create_index(
        "ix_notification_audience_published",
        "notification",
        ["audience", sa.literal_column("published_at DESC")],
        unique=False,
        postgresql_where=sa.text("audience <> 'user'"),
    )

    op.create_table(
        "notification_read",
        sa.Column("auth_user_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("notification_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("auth_user_id", "notification_id"),
    )


def downgrade() -> None:
    op.drop_table("notification_read")
    op.drop_index("ix_notification_audience_published", table_name="notification")
    op.drop_index("ix_notification_recipient_published", table_name="notification")
    op.drop_table("notification")
