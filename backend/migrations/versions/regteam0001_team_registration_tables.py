"""Team registration: registration_team, registration_team_invite, roster linkage.

Revision ID: regteam0001
Revises: regwin0001
Create Date: 2026-08-20 00:00:00.000000

Adds the data model for teams registering as a unit
(docs/plans/2026-08-20-team-registration.md §3).

Three shapes worth calling out, because each was a deliberate design decision
rather than the obvious choice:

* **No slot table.** A registered team's roster IS a set of ordinary
  ``balancer.registration`` rows carrying ``registration_team_id``. A slot table
  would give every slot its own state machine alongside the registration's
  ``status``, and the two would have to be kept in sync forever. The cost is the
  three additive columns below — all nullable or defaulted, so no backfill.

* **An invite is NOT a placeholder registration.** It lives in its own table
  because an unaccepted invite has no person behind it, and a placeholder
  registration row would silently inflate ``get_registration_count_by_tournament``
  — the public participant count — with nothing to catch it at compile time.

* **Only the token HASH is stored.** Redeeming an invite token creates a
  registration bound to the redeemer inside a third party's roster and consumes a
  roster slot, which puts it in the same tier as ``auth.api_key.secret_hash``, not
  the tier of a scrim room's shareable address.

``registration_team.captain_registration_id`` and
``registration.registration_team_id`` are mutually referential, so the two FKs are
added after both tables exist (the ``use_alter`` pattern already used by
``balancer.draft_session.current_pick_id``).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "regteam0001"
down_revision: str | Sequence[str] | None = "regwin0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "registration_team",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("name_normalized", sa.String(length=255), nullable=False),
        sa.Column("image_url", sa.String(length=255), nullable=True),
        # FK added below: circular with balancer.registration.
        sa.Column("captain_registration_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="forming", nullable=False),
        sa.Column("exported_team_id", sa.BigInteger(), nullable=True),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("export_status", sa.String(length=32), nullable=True),
        sa.Column("export_error", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["exported_team_id"], ["tournament.team.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["deleted_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_team_tournament_id"),
        "registration_team",
        ["tournament_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_team_workspace_id"),
        "registration_team",
        ["workspace_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_team_captain_registration_id"),
        "registration_team",
        ["captain_registration_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_team_exported_team_id"),
        "registration_team",
        ["exported_team_id"],
        unique=False,
        schema="balancer",
    )
    # Mirrors the export writer's dedup-by-lowercased-name rule, so two teams
    # registering under the same name can never silently merge into one roster.
    op.create_index(
        "uq_balancer_registration_team_name_active",
        "registration_team",
        ["tournament_id", "name_normalized"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_balancer_registration_team_tournament_status",
        "registration_team",
        ["tournament_id", "status"],
        unique=False,
        schema="balancer",
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "registration_team_invite",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("team_id", sa.BigInteger(), nullable=False),
        sa.Column("slot_code", sa.String(length=16), nullable=False),
        sa.Column("is_substitute", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("target_auth_user_id", sa.BigInteger(), nullable=True),
        sa.Column("token_sha256", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("invited_by", sa.BigInteger(), nullable=True),
        sa.Column("invited_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_registration_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["team_id"], ["balancer.registration_team.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_auth_user_id"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invited_by"], ["auth.user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["accepted_registration_id"], ["balancer.registration.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_team_invite_team_id"),
        "registration_team_invite",
        ["team_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_team_invite_target_auth_user_id"),
        "registration_team_invite",
        ["target_auth_user_id"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "ix_balancer_registration_team_invite_team_state",
        "registration_team_invite",
        ["team_id", "state"],
        unique=False,
        schema="balancer",
    )
    op.create_index(
        "uq_balancer_registration_team_invite_token",
        "registration_team_invite",
        ["token_sha256"],
        unique=True,
        schema="balancer",
        postgresql_where=sa.text("token_sha256 IS NOT NULL"),
    )

    # Roster linkage on the registration itself. All three are nullable or
    # defaulted: an existing row means "not on a team" with no backfill.
    op.add_column(
        "registration",
        sa.Column("registration_team_id", sa.BigInteger(), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "registration",
        sa.Column("team_slot_code", sa.String(length=16), nullable=True),
        schema="balancer",
    )
    op.add_column(
        "registration",
        sa.Column("is_substitute", sa.Boolean(), server_default="false", nullable=False),
        schema="balancer",
    )
    op.create_index(
        op.f("ix_balancer_registration_registration_team_id"),
        "registration",
        ["registration_team_id"],
        unique=False,
        schema="balancer",
    )

    # The two mutually referential FKs, once both tables exist.
    op.create_foreign_key(
        "fk_registration_registration_team",
        "registration",
        "registration_team",
        ["registration_team_id"],
        ["id"],
        source_schema="balancer",
        referent_schema="balancer",
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_registration_team_captain_registration",
        "registration_team",
        "registration",
        ["captain_registration_id"],
        ["id"],
        source_schema="balancer",
        referent_schema="balancer",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_registration_team_captain_registration",
        "registration_team",
        schema="balancer",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_registration_registration_team",
        "registration",
        schema="balancer",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_balancer_registration_registration_team_id"),
        table_name="registration",
        schema="balancer",
    )
    op.drop_column("registration", "is_substitute", schema="balancer")
    op.drop_column("registration", "team_slot_code", schema="balancer")
    op.drop_column("registration", "registration_team_id", schema="balancer")
    op.drop_table("registration_team_invite", schema="balancer")
    op.drop_table("registration_team", schema="balancer")
