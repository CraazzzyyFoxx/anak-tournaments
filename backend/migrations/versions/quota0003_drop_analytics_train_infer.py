"""Drop the ``analytics.train`` / ``analytics.infer`` metered operations.

Revision ID: quota0003
Revises: schemasplit01
Create Date: 2026-10-21 00:00:00.000000

The direct ``POST /api/v1/analytics/train`` and ``/infer`` dispatch endpoints
(``rpc.analytics.train`` / ``rpc.analytics.infer``) are gone -- training and
inference run as ``kind=train_ml`` / ``kind=compute`` analytics jobs -- so
nothing charges these slugs any more, and a ``quota.operation`` row with no call
site is dead weight (see ``quota0002``). Nothing references an operation row:
plan, workspace and API-key limits are per scope, and the Redis usage counters
are keyed by principal and day, so deleting the rows touches nothing else.

The downgrade restores exactly what ``quota0002`` seeded for the two slugs.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "quota0003"
down_revision: str | Sequence[str] | None = "schemasplit01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (slug, cost, description) exactly as ``quota0002`` seeded them.
OPERATIONS: tuple[tuple[str, int, str], ...] = (
    ("analytics.train", 10, "Trains the analytics models: the most CPU-expensive call in the platform"),
    ("analytics.infer", 5, "Runs inference over a tournament"),
)


def upgrade() -> None:
    # Literal SQL: ``op.execute`` also renders offline, where bound parameters cannot follow.
    slugs = ", ".join(f"'{slug}'" for slug, _, _ in OPERATIONS)
    op.execute(f"DELETE FROM quota.operation WHERE slug IN ({slugs})")


def downgrade() -> None:
    rows = ",\n".join(f"    ('{slug}', {cost}, true, '{description}')" for slug, cost, description in OPERATIONS)
    op.execute(
        "INSERT INTO quota.operation (slug, cost, enabled, description) VALUES\n"
        f"{rows}\n"
        "ON CONFLICT (slug) DO UPDATE SET cost = EXCLUDED.cost, description = EXCLUDED.description"
    )
