"""add subscription entitlement tables

Creates the ``subscriptions`` schema with two tables:

- ``provider_config`` -- per-workspace, per-provider setup (Discord guild + role
  mapping, challenge-code digests, Twitch broadcaster).
- ``entitlement`` -- last-known tri-state verdict per (workspace, user, provider).

Verdicts are persisted rather than cached only in Redis because admin list views
must render hundreds of them without a live provider call each (Discord
rate-limits member fetches per guild bucket), and because admission decisions
need an audit trail. See
docs/superpowers/specs/2026-08-03-subscription-entitlements-design.md.

Chained off ``statidx001`` rather than the current local head
``logretry0001``: the latter is uncommitted work-in-progress, and referencing an
untracked revision would leave this migration dangling for anyone checking out
this commit without it.

Revision ID: subs0001
Revises: statidx001
Create Date: 2026-08-03

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "subs0001"
down_revision: str | Sequence[str] | None = "statidx001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "subscriptions"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")

    # Column types mirror db.TimeStampIntegerMixin exactly: BigInteger pk,
    # created_at with a server default, updated_at nullable with NO server
    # default (the mixin sets it via onupdate).
    op.create_table(
        "provider_config",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("config_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("workspace_id", "provider", name="uq_subscription_config_workspace_provider"),
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_subscriptions_provider_config_workspace_id"),
        "provider_config",
        ["workspace_id"],
        schema=SCHEMA,
    )

    op.create_table(
        "entitlement",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        # Tri-state verdict; defaults to `unknown`, which fails open, so a row
        # that exists but was never resolved cannot refuse anybody.
        sa.Column("state", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("tier_rank", sa.Integer(), nullable=True),
        sa.Column("tier_label", sa.String(64), nullable=True),
        sa.Column("source", sa.String(32), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "workspace_id",
            "auth_user_id",
            "provider",
            name="uq_subscription_entitlement_scope",
        ),
        schema=SCHEMA,
    )
    # Bulk read path: every registrant's verdict for one workspace + provider.
    op.create_index(
        "ix_subscription_entitlement_workspace_provider",
        "entitlement",
        ["workspace_id", "provider"],
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_subscriptions_entitlement_workspace_id"),
        "entitlement",
        ["workspace_id"],
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_subscriptions_entitlement_auth_user_id"),
        "entitlement",
        ["auth_user_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_subscriptions_entitlement_auth_user_id"), "entitlement", schema=SCHEMA)
    op.drop_index(op.f("ix_subscriptions_entitlement_workspace_id"), "entitlement", schema=SCHEMA)
    op.drop_index("ix_subscription_entitlement_workspace_provider", "entitlement", schema=SCHEMA)
    op.drop_table("entitlement", schema=SCHEMA)

    op.drop_index(
        op.f("ix_subscriptions_provider_config_workspace_id"),
        "provider_config",
        schema=SCHEMA,
    )
    op.drop_table("provider_config", schema=SCHEMA)

    # Only the tables above live here, so dropping the schema is safe; RESTRICT
    # (the default) makes Postgres refuse if anything unexpected was added.
    op.execute(f"DROP SCHEMA IF EXISTS {SCHEMA}")
