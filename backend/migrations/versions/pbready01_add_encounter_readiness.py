"""Add encounter_readiness table (captain ready-up gate for pick-ban rooms).

Revision ID: pbready01
Revises: balstat0002
Create Date: 2026-08-10 00:00:00.000000

Adds ``tournament.encounter_readiness``: one row per (encounter, side) once
that side's captain has confirmed readiness to begin the encounter's
pre-game phase. ``ensure_pick_ban_session`` (both map and hero kinds) refuses
to create a session until both sides have a row here — see
``shared.models.tournament.pick_ban.EncounterReadiness`` docstring.

Purely additive.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "pbready01"
down_revision: str | Sequence[str] | None = "balstat0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "encounter_readiness",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("side", sa.String(16), nullable=False),
        sa.Column("ready_user_id", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["encounter_id"], ["tournament.encounter.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ready_user_id"], ["identity.user.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("encounter_id", "side", name="uq_encounter_readiness_encounter_side"),
        schema="tournament",
    )
    op.create_index(
        "ix_encounter_readiness_encounter_id", "encounter_readiness", ["encounter_id"], schema="tournament"
    )


def downgrade() -> None:
    op.drop_index("ix_encounter_readiness_encounter_id", table_name="encounter_readiness", schema="tournament")
    op.drop_table("encounter_readiness", schema="tournament")
