"""Seed the collection-admin RBAC permissions (rank + subscription)

Revision ID: subperm0001
Revises: pbready01
Create Date: 2026-08-11 00:00:00.000000

``rank.*`` and ``subscription.*`` gate the rank- and subscription-collection
admin RPCs, which used to demand the *global* ``admin`` role instead — so a
workspace owner was refused on their own workspace's collection health. The
handlers now check the permission, and existing databases need the catalog rows
(plus the grant on every workspace ``admin`` system role, whose grants are an
enumerated list; ``owner`` already holds the ``admin.*`` wildcard).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "subperm0001"
down_revision: str | Sequence[str] | None = "pbready01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PERMISSIONS = (
    ("rank.read", "rank", "read", "Read rank-collection health and fetch history"),
    ("rank.update", "rank", "update", "Trigger a rank re-fetch"),
    ("subscription.read", "subscription", "read", "Read subscription-collection health and check history"),
    ("subscription.update", "subscription", "update", "Trigger a subscription re-check"),
)


def upgrade() -> None:
    connection = op.get_bind()
    for name, resource, action, description in _PERMISSIONS:
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
                ON CONFLICT (name) DO UPDATE
                SET resource = EXCLUDED.resource,
                    action = EXCLUDED.action,
                    description = EXCLUDED.description
                """
            ),
            {"name": name, "resource": resource, "action": action, "description": description},
        )

    # Workspace `admin` system roles are enumerated grants, so a new catalog entry
    # has to be attached explicitly; `owner` is `admin.*` and needs nothing.
    connection.execute(
        sa.text(
            """
            INSERT INTO auth.role_permissions (role_id, permission_id, created_at)
            SELECT r.id, p.id, now()
            FROM auth.roles r
            JOIN auth.permissions p ON p.name = ANY(CAST(:permission_names AS varchar[]))
            WHERE r.name = 'admin'
              AND r.workspace_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM auth.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        ),
        {"permission_names": [name for name, *_ in _PERMISSIONS]},
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            """
            DELETE FROM auth.role_permissions
            WHERE permission_id IN (
                SELECT id FROM auth.permissions WHERE name = ANY(CAST(:permission_names AS varchar[]))
            )
            """
        ),
        {"permission_names": [name for name, *_ in _PERMISSIONS]},
    )
    connection.execute(
        sa.text("DELETE FROM auth.permissions WHERE name = ANY(CAST(:permission_names AS varchar[]))"),
        {"permission_names": [name for name, *_ in _PERMISSIONS]},
    )
