"""Pick-ban undo consent: who asked to take the last action back, and which one

Revision ID: pbundo01
Revises: subperm0001
Create Date: 2026-08-11 00:00:00.000000

A captain who bans the wrong hero had exactly one way out: ask an organizer to
reset the whole session (``reset_pick_ban_session``), scrapping every action of
the round. Two columns on ``tournament.pick_ban_session`` turn that into a
consent flow the captains own -- one asks, the opponent agrees, the last action
is reverted and nothing else is:

- ``undo_requested_by`` -- the side whose captain asked. The OPPONENT's matching
  call is what applies the undo; the same side calling twice changes nothing.
- ``undo_target_index`` -- the ``pick_ban_entry.action_index`` the request was
  made against, so a consent can never apply to an action that landed after it.

Both NULL means no request is open, which is what every existing session gets --
no backfill, no default beyond NULL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "pbundo01"
down_revision: str | Sequence[str] | None = "subperm0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SIDE_ENUM = postgresql.ENUM(name="pickbanside", schema="tournament", create_type=False)


def upgrade() -> None:
    op.add_column(
        "pick_ban_session",
        sa.Column("undo_requested_by", _SIDE_ENUM, nullable=True),
        schema="tournament",
    )
    op.add_column(
        "pick_ban_session",
        sa.Column("undo_target_index", sa.Integer(), nullable=True),
        schema="tournament",
    )


def downgrade() -> None:
    op.drop_column("pick_ban_session", "undo_target_index", schema="tournament")
    op.drop_column("pick_ban_session", "undo_requested_by", schema="tournament")
