"""Copy mix-canon ranks back onto follow registrations.

Revision ID: wsplyr06
Revises: mixperm01
Create Date: 2026-08-25 00:00:00.000000

Tournament ranks no longer read ``workspace_player_rank``. Rows that followed
the shared canon have ``registration_role.rank_value IS NULL`` and would go
blank. Restore the last known value onto the registration, then the two stores
diverge.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsplyr06"
down_revision: str | Sequence[str] | None = "mixperm01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE balancer.registration_role AS role
            SET rank_value = canon.rank_value
            FROM balancer.registration AS registration
            JOIN balancer.workspace_player_rank AS canon
              ON canon.workspace_player_id = registration.workspace_player_id
             AND canon.role = role.role
            WHERE role.registration_id = registration.id
              AND role.rank_value IS NULL
              AND canon.rank_value IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    # One-way restore; the live write path no longer keeps the two stores in sync.
    pass
