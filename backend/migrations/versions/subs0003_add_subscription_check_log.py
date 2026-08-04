"""add subscription check log

Adds ``subscriptions.check_log`` — the append-only history of subscription check
attempts, and the mirror of ``overwatch_rank.fetch_log``.

``subscriptions.entitlement`` is one mutable row per (workspace, user, provider)
overwritten on every check, so it can answer "are they subscribed now?" but never
"since when?" or "did this flap?". This table is that missing time series and
backs the admin Subscription-collection tab (health dashboard, live task history,
per-player timeline).

One row per *live* provider resolution only — cache hits and code-only refusals
are not attempts, exactly as the rank log skips dedup/cooldown hits.

Both FKs are ``SET NULL`` rather than ``CASCADE``: unlike the entitlement it
guards, the history of a deleted account or workspace is still the history of the
collector.

Revision ID: subs0003
Revises: boostynick0001
Create Date: 2026-08-04

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "subs0003"
down_revision: str | Sequence[str] | None = "boostynick0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "subscriptions"


def upgrade() -> None:
    # Column types mirror db.TimeStampIntegerMixin exactly: BigInteger pk,
    # created_at with a server default, updated_at nullable with NO server
    # default (the mixin sets it via onupdate). Rows are never updated here, but
    # the column stays so the model can keep the shared mixin.
    op.create_table(
        "check_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("provider", sa.String(32), nullable=False),
        # enums.SubscriptionCheckState: active / inactive / unknown / error.
        # `error` exists only here — the resolver answers `unknown` and persists
        # nothing when a strategy throws, so without it an outage would be
        # indistinguishable from a misconfigured provider.
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("tier_rank", sa.Integer(), nullable=True),
        sa.Column("tier_label", sa.String(64), nullable=True),
        # What triggered the check (enums.SubscriptionCollectionSource).
        sa.Column("source", sa.String(32), nullable=False, server_default="scheduled"),
        # How it was proven (the verdict's own source: discord_role, twitch_helix,
        # challenge_code, resolver). Distinct from `source`, which is the trigger.
        sa.Column("mechanism", sa.String(32), nullable=True),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        schema=SCHEMA,
    )
    # Newest-first feed, and the same feed filtered by outcome.
    op.create_index(
        "ix_subscription_check_log_created_at",
        "check_log",
        ["created_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_subscription_check_log_state_created",
        "check_log",
        ["state", "created_at"],
        schema=SCHEMA,
    )
    # Per-player timeline in the admin detail view.
    op.create_index(
        "ix_subscription_check_log_user_created",
        "check_log",
        ["auth_user_id", "created_at"],
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_subscriptions_check_log_workspace_id"),
        "check_log",
        ["workspace_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_subscriptions_check_log_workspace_id"), "check_log", schema=SCHEMA)
    op.drop_index("ix_subscription_check_log_user_created", "check_log", schema=SCHEMA)
    op.drop_index("ix_subscription_check_log_state_created", "check_log", schema=SCHEMA)
    op.drop_index("ix_subscription_check_log_created_at", "check_log", schema=SCHEMA)
    op.drop_table("check_log", schema=SCHEMA)
