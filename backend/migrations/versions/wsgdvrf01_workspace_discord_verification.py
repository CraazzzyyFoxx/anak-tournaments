"""Workspace Discord-guild verification + owner_id.

Revision ID: wsgdvrf01
Revises: casual01
Create Date: 2026-08-26 00:00:00.000000

Part of the workspace self-service design
(``docs/superpowers/specs/2026-08-26-workspace-self-service-design.md``, §4.1/§4.2).
Phase 1, Task 3 of the paired implementation plan.

Three additions, one revision, pure expand -- nothing here is read by any
running code until the next deploy, so there is no ordering hazard:

* ``discord_guild_id`` gains a UNIQUE constraint. Today any workspace admin can
  set it to any string that matches the snowflake pattern, including one
  already claimed by another workspace -- there is no proof of ownership and
  no uniqueness at all. This revision only adds the constraint; the app-level
  ownership proof and the retirement of the free-text ``PATCH`` path land in a
  later task of the same plan, deliberately split so a database-level
  invariant does not wait on an application deploy.
* ``discord_guild_verified_at`` / ``discord_guild_verified_by_auth_user_id``
  record who proved ownership and when -- the same audit shape as
  ``custom_domain_verified_at`` / ``custom_domain_verification_token`` already
  carry for the sibling white-label feature.
* ``owner_id`` is a plain FK to ``auth.user``, deliberately decoupled from the
  RBAC ``owner`` role (``auth.roles``, per-workspace-scoped, mutable, can have
  co-owners). It answers "who created this workspace", used later by the
  self-service create cap (``WorkspaceRepository.count_by_owner``) -- counting
  through the RBAC role instead would double-count co-owned workspaces and let
  an actor free their own cap by reassigning the role away from themselves
  after granting it to someone else. See the design's Decision Log for the
  full argument against the RBAC-join alternative.

Backfill: ``discord_guild_id`` needs none (only Alembic hand-editing has ever
written it, and the pre-flight collision query in Task 1 must have reported
zero duplicates before this migration runs -- a duplicate here means
``create_unique_constraint`` fails outright, which is the correct, loud
failure mode). ``owner_id`` backfills from the current single RBAC ``owner``
role holder, where a workspace has exactly one; workspaces with zero or more
than one holder are left NULL deliberately (ambiguous, not guessed -- see the
design's Risks section and Task 1's Step 1b pre-flight count).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "wsgdvrf01"
down_revision: str | Sequence[str] | None = "casual01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("uq_workspace_discord_guild_id", "workspace", ["discord_guild_id"])

    op.add_column(
        "workspace",
        sa.Column("discord_guild_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "workspace",
        sa.Column("discord_guild_verified_by_auth_user_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_workspace_discord_guild_verified_by_auth_user_id",
        "workspace",
        "user",
        ["discord_guild_verified_by_auth_user_id"],
        ["id"],
        referent_schema="auth",
        ondelete="SET NULL",
    )

    op.add_column(
        "workspace",
        sa.Column("owner_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_workspace_owner_id",
        "workspace",
        "user",
        ["owner_id"],
        ["id"],
        referent_schema="auth",
        ondelete="SET NULL",
    )
    op.create_index("ix_workspace_owner_id", "workspace", ["owner_id"])

    # Backfill owner_id from the current RBAC "owner" role, only where a
    # workspace has exactly one holder -- ambiguous cases (0 or >1 holders)
    # stay NULL, per the design's Risks section and Task 1's Step 1b count.
    op.execute(
        """
        WITH single_owner AS (
            SELECT r.workspace_id, MIN(ur.user_id) AS user_id
            FROM auth.user_roles ur
            JOIN auth.roles r ON r.id = ur.role_id AND r.name = 'owner'
            GROUP BY r.workspace_id
            HAVING COUNT(DISTINCT ur.user_id) = 1
        )
        UPDATE workspace w
        SET owner_id = so.user_id
        FROM single_owner so
        WHERE so.workspace_id = w.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_owner_id", table_name="workspace")
    op.drop_constraint("fk_workspace_owner_id", "workspace", type_="foreignkey")
    op.drop_column("workspace", "owner_id")

    op.drop_constraint("fk_workspace_discord_guild_verified_by_auth_user_id", "workspace", type_="foreignkey")
    op.drop_column("workspace", "discord_guild_verified_by_auth_user_id")
    op.drop_column("workspace", "discord_guild_verified_at")

    op.drop_constraint("uq_workspace_discord_guild_id", "workspace", type_="unique")
