"""add subscription admission requirement to registration_form

Adds a per-tournament admission requirement enforced at CHECK-IN only:

- ``require_subscription`` -- master toggle, kept separate from the blob (like
  ``workspace.branding_enabled``) so switching the gate off does not destroy the
  organizer's configured providers and thresholds.
- ``subscription_requirement_json`` -- ``{mode, requirements}`` where ``mode`` is
  ``any``/``all`` and each requirement is ``{provider, min_tier_rank}``. Scalar
  columns cannot express "any one of N", and each provider needs its own threshold
  because Boosty levels and Twitch tiers are unrelated scales.

Both default to "off", so every existing tournament is unaffected.

Revision ID: subs0002
Revises: subs0001
Create Date: 2026-08-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "subs0002"
down_revision: str | Sequence[str] | None = "subs0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration_form",
        sa.Column(
            "require_subscription",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        schema="balancer",
    )
    op.add_column(
        "registration_form",
        sa.Column(
            "subscription_requirement_json",
            sa.JSON(),
            nullable=False,
            server_default="{}",
        ),
        schema="balancer",
    )


def downgrade() -> None:
    op.drop_column("registration_form", "subscription_requirement_json", schema="balancer")
    op.drop_column("registration_form", "require_subscription", schema="balancer")
