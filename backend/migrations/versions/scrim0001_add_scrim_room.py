"""Add scrim_room table (ad-hoc pre-game rooms outside a tournament).

Revision ID: scrim0001
Revises: heroflex0001
Create Date: 2026-08-12 00:00:00.000000

Adds ``tournament.scrim_room``: a share token over an encounter provisioned
inside a per-workspace hidden container tournament, so two captains can run the
existing pre-game loop for a scrim. See
``shared.models.tournament.scrim.ScrimRoom`` and
``docs/plans/2026-08-12-scrim-rooms.md``.

Purely additive — no existing table, type or row is touched. Nothing else needs
a migration: the container tournament rides ``Tournament.is_hidden`` (already
present since ``hidden0001``), and the per-user active-room cap lives in the
schema-less ``public.settings`` blob.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "scrim0001"
down_revision: str | Sequence[str] | None = "heroflex0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scrim_room",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token", sa.String(32), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("stage_id", sa.BigInteger(), nullable=False),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("created_by_auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["stage_id"], ["tournament.stage.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token", name="uq_scrim_room_token"),
        sa.UniqueConstraint("encounter_id", name="uq_scrim_room_encounter"),
        schema="tournament",
    )
    op.create_index("ix_scrim_room_workspace_id", "scrim_room", ["workspace_id"], schema="tournament")
    op.create_index("ix_scrim_room_tournament_id", "scrim_room", ["tournament_id"], schema="tournament")
    op.create_index("ix_scrim_room_stage_id", "scrim_room", ["stage_id"], schema="tournament")
    op.create_index("ix_scrim_room_encounter_id", "scrim_room", ["encounter_id"], schema="tournament")
    op.create_index(
        "ix_scrim_room_created_by_auth_user_id", "scrim_room", ["created_by_auth_user_id"], schema="tournament"
    )
    # Partial: the cap counts only a creator's OPEN rooms, and closed history is
    # kept forever, so it must not weigh on the index that gates every create.
    op.create_index(
        "ix_scrim_room_open_by_creator",
        "scrim_room",
        ["created_by_auth_user_id"],
        schema="tournament",
        postgresql_where=sa.text("closed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_scrim_room_open_by_creator", table_name="scrim_room", schema="tournament")
    op.drop_index("ix_scrim_room_created_by_auth_user_id", table_name="scrim_room", schema="tournament")
    op.drop_index("ix_scrim_room_encounter_id", table_name="scrim_room", schema="tournament")
    op.drop_index("ix_scrim_room_stage_id", table_name="scrim_room", schema="tournament")
    op.drop_index("ix_scrim_room_tournament_id", table_name="scrim_room", schema="tournament")
    op.drop_index("ix_scrim_room_workspace_id", table_name="scrim_room", schema="tournament")
    op.drop_table("scrim_room", schema="tournament")
