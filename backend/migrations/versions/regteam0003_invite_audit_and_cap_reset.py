"""Invite revocation audit and the cumulative-cap watermark.

Revision ID: regteam0003
Revises: regteam0002
Create Date: 2026-08-21 00:00:00.000000

Two capabilities land together because they are the same story: an organizer may
now reach into a team's outstanding offers, and a power over someone else's roster
that leaves no trace is not a power anyone should hold.

``revoked_by``/``revoked_at`` record who withdrew an offer. A captain and an
organizer can both revoke, and those are materially different events -- without
this the two are indistinguishable after the fact.

``invite_cap_reset_at``/``invite_cap_reset_by`` are a WATERMARK, not a counter. The
cap is a COUNT over every invite a team ever created, so "reset" can only mean
"stop counting the ones before this moment". Deleting the old rows is the other way
to do it and is worse: the invite history is now a read, so clearing a cap that way
would erase the evidence of whatever abuse prompted it.

Pure expand. Every column is nullable with no backfill, so old images keep working
against the new schema and this needs no deploy ordering.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "regteam0003"
down_revision: str | None = "regteam0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration_team_invite",
        sa.Column("revoked_by", sa.Integer(), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "registration_team_invite",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "registration_team_invite",
        # Recorded by the entry point that knows, not inferred at read time:
        # comparing the revoker against "the captain" would be a lie, since
        # captaincy transfers and the captain now is not the captain then.
        sa.Column("revoked_by_organizer", sa.Boolean(), nullable=False, server_default="false"),
        schema="balancer",
    )
    op.create_foreign_key(
        "fk_registration_team_invite_revoked_by",
        "registration_team_invite",
        "user",
        ["revoked_by"],
        ["id"],
        source_schema="balancer",
        referent_schema="auth",
        ondelete="SET NULL",
    )

    op.add_column(
        "registration_team",
        sa.Column("invite_cap_reset_at", sa.DateTime(timezone=True), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "registration_team",
        sa.Column("invite_cap_reset_by", sa.Integer(), nullable=True),
        schema="balancer",
    )
    op.create_foreign_key(
        "fk_registration_team_invite_cap_reset_by",
        "registration_team",
        "user",
        ["invite_cap_reset_by"],
        ["id"],
        source_schema="balancer",
        referent_schema="auth",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_registration_team_invite_cap_reset_by",
        "registration_team",
        schema="balancer",
        type_="foreignkey",
    )
    op.drop_column("registration_team", "invite_cap_reset_by", schema="balancer")
    op.drop_column("registration_team", "invite_cap_reset_at", schema="balancer")

    op.drop_constraint(
        "fk_registration_team_invite_revoked_by",
        "registration_team_invite",
        schema="balancer",
        type_="foreignkey",
    )
    op.drop_column("registration_team_invite", "revoked_at", schema="balancer")
    op.drop_column("registration_team_invite", "revoked_by", schema="balancer")
    op.drop_column("registration_team_invite", "revoked_by_organizer", schema="balancer")
