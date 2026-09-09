"""Workspace verification tier.

Revision ID: wstier001
Revises: tiegrp01
Create Date: 2026-09-07 00:00:00.000000

Part of the workspace self-service design
(``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md`` §4.2),
Phase 2 of the paired implementation plan.

``verification_status`` is the tier that makes self-service creation safe to
open: an ``unverified`` workspace cannot start GPU compute jobs, its
full-history achievement recomputes are deferred to a low-concurrency queue,
and it stays off the public directory. Plain ``String(16)``, not a Postgres
enum -- same precedent as ``newcomer_scope``, so a fourth tier never needs a
migration.

Backfill: every workspace that exists before self-service ships is
grandfathered to ``trusted``. Self-service gates new entrants; retroactively
degrading a running tournament's workspace would be a live incident, not a
security win (design A6). The design's §4.2 said ``verified`` here, but §4.5
then makes the public directory ``trusted``-only -- taken together those two
would have silently dropped every existing workspace off the home page on
deploy. Incumbents were all created by hand by a superuser, which is exactly
what ``trusted`` means, so the two intents reconcile at ``trusted``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wstier001"
down_revision: str | Sequence[str] | None = "tiegrp01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="unverified"),
    )
    op.execute("UPDATE workspace SET verification_status = 'trusted'")


def downgrade() -> None:
    op.drop_column("workspace", "verification_status")
