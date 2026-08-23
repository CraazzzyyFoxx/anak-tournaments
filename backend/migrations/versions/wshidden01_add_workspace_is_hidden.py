"""Add workspace.is_hidden.

Revision ID: wshidden01
Revises: regteam0003
Create Date: 2026-08-23 00:00:00.000000

Excludes a workspace from the public directory (home page + anonymous
``GET /api/v1/workspaces``) while leaving direct access (slug page, subdomain,
verified custom domain) untouched. Orthogonal to ``is_active`` and to
``Tournament.is_hidden`` -- no cascade between the two by design (see
``WorkspaceService.get_all``).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wshidden01"
down_revision: str | Sequence[str] | None = "regteam0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("workspace", "is_hidden")
