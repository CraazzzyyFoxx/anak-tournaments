"""Add ``players.user.stream_visible``.

Revision ID: streamvis01
Revises: tlink0001
Create Date: 2026-08-16 00:00:00.000000

Until now, "show my Twitch on my profile" and "surface my live stream on
tournament pages" were the same switch: the only way to stay off the tournament
page was to hide the account from the public profile entirely
(``social_account_visibility``). Worse, the verified path in stream-service had
no per-tournament consent at all — a verified, publicly visible Twitch account
was enough. This column separates the two so a participant can keep their handle
on their profile and still refuse to be broadcast.

Semantics are a veto: ``false`` outranks the per-tournament
``balancer.registration.stream_pov`` opt-in AND the social account's global
visibility row. Enforced in stream-service at both the poll-target query and the
public read, so a flip takes effect immediately rather than at the next tick.

``server_default='true'`` so the deploy itself hides nobody — existing rows keep
the behaviour they had, and opting out stays an explicit act.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "streamvis01"
down_revision: str | Sequence[str] | None = "tlink0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("stream_visible", sa.Boolean(), server_default="true", nullable=False),
        schema="players",
    )


def downgrade() -> None:
    op.drop_column("user", "stream_visible", schema="players")
