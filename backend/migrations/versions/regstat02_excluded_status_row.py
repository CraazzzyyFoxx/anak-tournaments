"""The global built-in ``excluded`` balancer status row, and ``not_in_balancer``'s description as the code states it.

Revision ID: regstat02
Revises: mixaway01
Create Date: 2026-10-22 00:00:00.000000

``regstat01`` re-seeded the nine rows of the v5 seed, which never had ``excluded``: Settings > Player statuses did not
list it and overriding it 404'd (``status_catalog.py`` copies the global row). It is inserted where missing, with the
code's meta (``BUILTIN_STATUS_META``), the same way ``regstat01`` inserts.

The v5 seed described ``not_in_balancer`` as "excluded from the balancer pool" -- what ``excluded`` means. The code and
both UI locales say it has not been added yet, so the global row is reworded, but only while it still holds the seed's
text. Workspace overrides are the workspace's own copies and stay as they are.

Downgrade is a no-op: the previous revision's code already knows both statuses.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "regstat02"
down_revision: str | Sequence[str] | None = "mixaway01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "INSERT INTO registration.status (scope, slug, kind, icon_slug, icon_color, name, description) "
            "SELECT 'balancer', 'excluded', 'builtin', 'ShieldOff', '#ef4444', 'Excluded', "
            "'Manually removed from the balancer pool after being added.' "
            "WHERE NOT EXISTS (SELECT 1 FROM registration.status "
            "WHERE workspace_id IS NULL AND scope = 'balancer' AND slug = 'excluded' AND kind = 'builtin')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE registration.status "
            "SET description = 'Registration has not been added to the balancer pool yet.' "
            "WHERE workspace_id IS NULL AND scope = 'balancer' AND slug = 'not_in_balancer' AND kind = 'builtin' "
            "AND description = 'Registration is excluded from the balancer pool.'"
        )
    )


def downgrade() -> None:
    pass
