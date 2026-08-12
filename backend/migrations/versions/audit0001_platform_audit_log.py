"""platform audit log -- one table that answers "who did this"

Revision ID: audit0001
Revises: mapidx01
Create Date: 2026-08-12 12:00:00.000000

Creates ``public.audit_log``. Six domain journals already exist and are left
alone; none of them covers the surface this one does -- role and permission
changes, deny entries, API keys, session revocation, account deletion, player
links and unlinks, tournament edits and deletes, workspace settings, branding,
custom domains, the Discord guild. Until now the only trace of those was stdout,
where there is neither a structured actor nor a workspace filter.

The table carries no foreign keys, by the convention ``event_outbox`` and
``realtime.workspace_event`` already follow: the row has to outlive the actor and
the entity it describes. A CASCADE would delete a deleted tournament's history,
and a SET NULL would blank the actor of a deleted account -- so the referents are
kept as ``*_label`` snapshots instead.

Three composite indexes, all trailing in ``created_at``, because every read is
"newest first" over a workspace, an entity, or an actor. ``created_at`` and not
``id``: ``now()`` is the transaction start time, so a long transaction gets a
high ``id`` under an early timestamp and ``id`` order is not time order. Filters
on ``action``/``source`` stay heap filters -- at ~45 MB/year a fourth index costs
writes on a growing table for nothing measurable.

There is no backfill of rows: the actor of a past action is unrecoverable, the
same call ``encres0001`` made for ``encounter_result_audit``. ``downgrade`` drops
the table, and the rows go with it.

The revision also seeds the ``audit.read`` permission and grants it to every
existing workspace ``admin`` role. That grant cannot wait for the application:
``ensure_permission_catalog`` upserts the catalog row on boot but never touches
``auth.role_permissions``, and the only writer of those -- ``ensure_workspace_
system_roles`` -- runs on workspace creation, ``assign_workspace_system_role``
and ``add_member``, not on deploy. Without the backfill every organizer of an
existing workspace would get a 403 on ``/admin/audit`` until somebody happened to
add a member. ``owner`` needs nothing: it holds the ``admin.*`` wildcard
(``permission_names_for_workspace_role``), so only the enumerated ``admin`` grant
list has a gap. Same shape as ``subperm0001``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "audit0001"
down_revision: str | Sequence[str] | None = "mapidx01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "audit_log"

# Mirrors ``_permission("audit", "read", ...)`` in ``shared/rbac/catalog.py``.
_PERMISSION_NAME = "audit.read"
_PERMISSION_RESOURCE = "audit"
_PERMISSION_ACTION = "read"
_PERMISSION_DESCRIPTION = "Read the platform audit log"


def upgrade() -> None:
    # No ``schema=``: the journal lives in ``public`` beside ``event_outbox``,
    # because it spans every domain and belongs to none of them.
    op.create_table(
        _TABLE,
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_label", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=True),
        sa.Column("entity_id", sa.BigInteger(), nullable=True),
        sa.Column("entity_label", sa.String(length=255), nullable=True),
        sa.Column("before_json", postgresql.JSONB(), nullable=True),
        sa.Column("after_json", postgresql.JSONB(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_audit_log_workspace_created",
        _TABLE,
        ["workspace_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_log_entity_created",
        _TABLE,
        ["entity_type", "entity_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_log_actor_created",
        _TABLE,
        ["actor_auth_user_id", "created_at"],
        unique=False,
    )

    connection = op.get_bind()
    # The revision may land before any worker calls ``ensure_permission_catalog``,
    # so the catalog row is seeded here too. ``DO NOTHING`` rather than
    # ``DO UPDATE``: the description is the application's to own, and it re-upserts
    # it on every boot.
    connection.execute(
        sa.text(
            """
            INSERT INTO auth.permissions (name, resource, action, description, created_at)
            VALUES (
                CAST(:name AS varchar),
                CAST(:resource AS varchar),
                CAST(:action AS varchar),
                CAST(:description AS varchar),
                now()
            )
            ON CONFLICT (name) DO NOTHING
            """
        ),
        {
            "name": _PERMISSION_NAME,
            "resource": _PERMISSION_RESOURCE,
            "action": _PERMISSION_ACTION,
            "description": _PERMISSION_DESCRIPTION,
        },
    )
    # Idempotency is ``NOT EXISTS``, not ``ON CONFLICT DO NOTHING``:
    # ``auth.role_permissions`` has a surrogate ``id`` primary key and no unique
    # constraint on the pair, so a conflict clause would never fire and a second
    # run would duplicate the grant instead of skipping it.
    connection.execute(
        sa.text(
            """
            INSERT INTO auth.role_permissions (role_id, permission_id, created_at)
            SELECT r.id, p.id, now()
            FROM auth.roles r
            JOIN auth.permissions p ON p.name = CAST(:name AS varchar)
            WHERE r.name = 'admin'
              AND r.workspace_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM auth.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        ),
        {"name": _PERMISSION_NAME},
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            DELETE FROM auth.role_permissions
            WHERE permission_id IN (
                SELECT id FROM auth.permissions WHERE name = CAST(:name AS varchar)
            )
            """
        ),
        {"name": _PERMISSION_NAME},
    )
    connection.execute(
        sa.text("DELETE FROM auth.permissions WHERE name = CAST(:name AS varchar)"),
        {"name": _PERMISSION_NAME},
    )

    op.drop_index("ix_audit_log_actor_created", table_name=_TABLE)
    op.drop_index("ix_audit_log_entity_created", table_name=_TABLE)
    op.drop_index("ix_audit_log_workspace_created", table_name=_TABLE)
    op.drop_table(_TABLE)
