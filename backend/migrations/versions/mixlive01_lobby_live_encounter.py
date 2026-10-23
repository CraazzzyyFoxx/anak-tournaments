"""A lobby's live match: ``mix.lobby.live_encounter_id``.

Revision ID: mixlive01
Revises: mixcapt01
Create Date: 2026-10-21 00:00:00.000000

Start match opens the lobby's encounter before the game is played; Record result completes it and writes the
``mix.round`` row, Cancel match deletes it (spec §5.1). The pointer is that open encounter: one per lobby (unique),
``ON DELETE SET NULL`` so deleting the encounter -- a cancel, a hard-deleted mix -- can never leave it dangling.

Nothing else changes: history, leaderboard, rotation, ranker and undo read ``mix.round``, which a live match does not
have yet. Deploy is a no-op: every lobby starts without a live match, so a lobby with a variant is simply Ready.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixlive01"
down_revision: str | Sequence[str] | None = "mixcapt01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("lobby", sa.Column("live_encounter_id", sa.BigInteger(), nullable=True), schema="mix")
    op.create_foreign_key(
        "fk_custom_game_lobby_live_encounter",
        "lobby",
        "encounter",
        ["live_encounter_id"],
        ["id"],
        source_schema="mix",
        referent_schema="encounter",
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_custom_game_lobby_live_encounter", "lobby", ["live_encounter_id"], schema="mix")


def downgrade() -> None:
    op.drop_constraint("uq_custom_game_lobby_live_encounter", "lobby", schema="mix", type_="unique")
    op.drop_constraint("fk_custom_game_lobby_live_encounter", "lobby", schema="mix", type_="foreignkey")
    op.drop_column("lobby", "live_encounter_id", schema="mix")
