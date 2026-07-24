"""collapse to one managed division grid per workspace

Archives all but the canonical division grid per workspace so the redesigned
admin manages a single grid. Canonical = the grid holding the workspace's
active (default) version, else the newest grid. Non-destructive: archived grids
keep their versions/tiers/mappings, so tournaments pinned to their versions and
the runtime normalizer are unaffected.

Revision ID: divgrid0003
Revises: divgrid0002
Create Date: 2026-07-24 18:00:00.000000
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "divgrid0003"
down_revision: str | Sequence[str] | None = "divgrid0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(UTC)

    workspaces = conn.execute(
        sa.text(
            """
            SELECT w.id AS workspace_id,
                   (SELECT v.grid_id FROM division_grid_version v
                     WHERE v.id = w.default_division_grid_version_id) AS default_grid_id
            FROM workspace w
            """
        )
    ).mappings().all()

    archive_stmt = sa.text(
        "UPDATE division_grid SET archived_at = :now WHERE id IN :ids"
    ).bindparams(sa.bindparam("ids", expanding=True))

    for row in workspaces:
        grid_ids = (
            conn.execute(
                sa.text(
                    """
                    SELECT id FROM division_grid
                    WHERE workspace_id = :ws AND archived_at IS NULL
                    ORDER BY id DESC
                    """
                ),
                {"ws": row["workspace_id"]},
            )
            .scalars()
            .all()
        )
        if len(grid_ids) <= 1:
            continue

        default_grid_id = row["default_grid_id"]
        canonical = default_grid_id if default_grid_id in grid_ids else grid_ids[0]
        to_archive = [grid_id for grid_id in grid_ids if grid_id != canonical]
        if to_archive:
            conn.execute(archive_stmt, {"now": now, "ids": to_archive})


def downgrade() -> None:
    # Data-only, non-destructive migration: archived grids can be restored
    # individually via the admin. No deterministic inverse.
    pass
