"""Cleanup obsolete RBAC permissions from auth.permissions table

Deletes legacy custom action permissions that were replaced by uniform CRUD
permissions and automatic workspace admin role handling.

Revision ID: rbac0002
Revises: wsreq0002
Create Date: 2026-08-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "rbac0002"
down_revision: str | None = "wsreq0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OBSOLETE_PERMISSIONS = (
    "role.assign",
    "auth_session.revoke",
    "team.import",
    "team.export",
    "player.import",
    "player.export",
    "match.sync",
    "standing.recalculate",
    "balancer.calculate",
    "balancer.generate",
    "balancer.publish",
    "balancer.export",
    "analytics.export",
    "analytics.recalculate",
    "achievement.calculate",
    "achievement.import",
    "achievement.export",
    "division_grid.import",
    "division_grid.export",
    "division_grid.publish",
    "division_grid.sync",
    "log.upload",
    "log.stream",
    "log.reprocess",
    "discord_channel.sync",
    "challonge.sync",
    "asset.upload",
    "registration_status.check_in",
)


def upgrade() -> None:
    names = ", ".join(f"'{name}'" for name in _OBSOLETE_PERMISSIONS)
    op.execute(f"DELETE FROM auth.permissions WHERE name IN ({names})")


def downgrade() -> None:
    pass
