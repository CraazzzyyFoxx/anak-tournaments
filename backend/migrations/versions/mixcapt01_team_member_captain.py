"""Snapshot each seat's captain on the encounter roster.

Revision ID: mixcapt01
Revises: defgrid01
Create Date: 2026-10-21 00:00:00.000000

``encounter.team_member.is_captain``: whether this member captained the team that took the seat, written by the
participation writer when the seat is filled (``shared.services.encounter.participants``). A mix match copies its
lineup's captain; a tournament seat copies ``tournament.team.captain_id`` -- a ``players.user`` id, joined to the seat's
``workspace_member`` through ``workspace_member.player_id``.

Existing tournament seats are backfilled from each team's current captain, the only captain the database still
knows; recorded mix rounds had none and stay ``false``. The UPDATE touches one row per seated team, not the table.
Downgrade drops the column.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "mixcapt01"
down_revision: str | Sequence[str] | None = "defgrid01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "team_member",
        sa.Column("is_captain", sa.Boolean(), server_default="false", nullable=False),
        schema="encounter",
    )
    op.execute(
        """
        UPDATE encounter.team_member AS tm
        SET is_captain = true
        FROM encounter.team AS et
        JOIN tournament.team AS t ON t.id = et.team_id
        JOIN public.workspace_member AS wm ON wm.player_id = t.captain_id
        WHERE et.id = tm.encounter_team_id
          AND wm.id = tm.workspace_member_id
        """
    )


def downgrade() -> None:
    op.drop_column("team_member", "is_captain", schema="encounter")
