"""The global built-in registration/balancer status rows ``initial_v6`` left out.

Revision ID: regstat01
Revises: defgrid01
Create Date: 2026-10-22 00:00:00.000000

The v5 chain's ``a7v1w5x6y7z8`` seeded one ``workspace_id IS NULL, kind = 'builtin'`` row per built-in status: the
status catalog lists them and a workspace override starts as a copy of one (``status_catalog.py``). ``initial_v6`` was
generated from the models and carries no data, so a fresh database had none: an empty catalog, and a 404 on every
override. A database that ran the v5 chain (stamped at ``initial_v6``) already has them, so each row is inserted only
where its global builtin is missing and that database is left as it is. The rows are that seed verbatim; ``excluded``
was never part of it.

Downgrade is a no-op: on a stamped database the rows predate this revision.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "regstat01"
down_revision: str | Sequence[str] | None = "defgrid01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (scope, slug, icon_slug, icon_color, name, description), as a7v1w5x6y7z8 wrote them.
BUILTINS = [
    ("registration", "pending", "Clock", "#f59e0b", "Pending", "Waiting for moderator review."),
    ("registration", "approved", "CheckCircle2", "#10b981", "Approved", "Registration approved."),
    ("registration", "rejected", "XCircle", "#ef4444", "Rejected", "Registration rejected."),
    ("registration", "withdrawn", "Undo2", "#94a3b8", "Withdrawn", "Registration withdrawn by participant or admin."),
    ("registration", "banned", "ShieldBan", "#ef4444", "Banned", "Registration blocked."),
    ("registration", "insufficient_data", "AlertTriangle", "#f97316", "Incomplete", "Registration data is incomplete."),
    (
        "balancer",
        "not_in_balancer",
        "MinusCircle",
        "#94a3b8",
        "Not Added",
        "Registration is excluded from the balancer pool.",
    ),
    (
        "balancer",
        "incomplete",
        "AlertTriangle",
        "#f97316",
        "Incomplete",
        "Registration needs role or rank fixes before balancing.",
    ),
    ("balancer", "ready", "CheckCircle2", "#10b981", "Ready", "Registration is ready for the balancer pool."),
]

# Not ON CONFLICT: the unique key includes workspace_id, and the global rows' NULL never conflicts. The casts give the
# twice-used parameters one type (the select list alone would read them as text, the WHERE as varchar).
_INSERT = sa.text(
    "INSERT INTO registration.status (scope, slug, kind, icon_slug, icon_color, name, description) "
    "SELECT CAST(:scope AS VARCHAR), CAST(:slug AS VARCHAR), 'builtin', :icon_slug, :icon_color, :name, :description "
    "WHERE NOT EXISTS (SELECT 1 FROM registration.status "
    "WHERE workspace_id IS NULL AND scope = :scope AND slug = :slug AND kind = 'builtin')"
)


def upgrade() -> None:
    bind = op.get_bind()
    for scope, slug, icon_slug, icon_color, name, description in BUILTINS:
        bind.execute(
            _INSERT,
            {
                "scope": scope,
                "slug": slug,
                "icon_slug": icon_slug,
                "icon_color": icon_color,
                "name": name,
                "description": description,
            },
        )


def downgrade() -> None:
    pass
