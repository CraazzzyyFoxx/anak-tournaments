"""Seed the ``custom_game.*`` RBAC permissions and grant them to existing roles.

Revision ID: mixperm01
Revises: schema01
Create Date: 2026-08-25 00:00:00.000000

Mixes used to be open to any workspace member; they now need their own grant.
The catalog rows themselves are code-seeded by
``shared.rbac.bootstrap.ensure_permission_catalog``, but that only runs behind
``ensure_workspace_system_roles`` -- workspace creation, member add, role grant.
A workspace with a settled membership therefore never touches it, so every
existing workspace would lose mixes entirely until its next membership write.
This revision closes that window by seeding the four permissions and wiring
them to the workspace roles ``permission_names_for_workspace_role`` would give
them: all four to ``admin``, read-only to ``member``. ``owner`` already holds
``admin.*`` and ``player`` holds nothing, so neither needs a row.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixperm01"
down_revision: str | Sequence[str] | None = "schema01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO auth.permissions (name, resource, action, description)
            SELECT v.name, 'custom_game', v.action, v.name
            FROM (
                VALUES
                    ('custom_game.read', 'read'),
                    ('custom_game.create', 'create'),
                    ('custom_game.update', 'update'),
                    ('custom_game.delete', 'delete')
            ) AS v(name, action)
            ON CONFLICT (name) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO auth.role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM auth.roles r
            CROSS JOIN auth.permissions p
            WHERE r.name = 'admin'
              AND r.workspace_id IS NOT NULL
              AND p.resource = 'custom_game'
              AND NOT EXISTS (
                  SELECT 1 FROM auth.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO auth.role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM auth.roles r
            CROSS JOIN auth.permissions p
            WHERE r.name = 'member'
              AND r.workspace_id IS NOT NULL
              AND p.name = 'custom_game.read'
              AND NOT EXISTS (
                  SELECT 1 FROM auth.role_permissions rp
                  WHERE rp.role_id = r.id AND rp.permission_id = p.id
              )
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            DELETE FROM auth.role_permissions
            WHERE permission_id IN (SELECT id FROM auth.permissions WHERE resource = 'custom_game')
            """
        )
    )
    op.execute(sa.text("DELETE FROM auth.permissions WHERE resource = 'custom_game'"))
