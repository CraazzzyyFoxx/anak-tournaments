"""Drop hero/gamemode/map RBAC permissions — game content is superuser-only.

Game metadata is global content shared by every workspace, so its admin surface
(app-service ``rpc/metadata_admin.py``, parser-service metadata sync) now gates
on ``is_superuser`` instead of workspace-delegable permissions. The rows are
removed so they can no longer be granted to a role that they would not empower.
``role_permissions`` / ``user_permission_deny`` cascade on permission delete.

Revision ID: gcsu0001
Revises: tnum0001
Create Date: 2026-07-28
"""

from alembic import op

revision = "gcsu0001"
down_revision = "tnum0001"
branch_labels = None
depends_on = None

_RESOURCES = ("hero", "gamemode", "map")
_ACTIONS = ("read", "create", "update", "delete", "sync")


def upgrade() -> None:
    op.execute("DELETE FROM auth.permissions WHERE resource IN ('hero', 'gamemode', 'map')")


def downgrade() -> None:
    values = ", ".join(
        f"('{resource}.{action}', '{resource}', '{action}')" for resource in _RESOURCES for action in _ACTIONS
    )
    op.execute(
        "INSERT INTO auth.permissions (name, resource, action, description, created_at) "
        f"SELECT name, resource, action, name, now() FROM (VALUES {values}) "
        "AS v(name, resource, action) ON CONFLICT (name) DO NOTHING"
    )
