"""Add ``players.favorite_player``.

Revision ID: favplyr01
Revises: enclogsrm1
Create Date: 2026-08-17 00:00:00.000000

A visitor's bookmark on a player (their own or someone else's), surfaced as the
star toggle on the profile toolbar, search results, and account settings. The
row is keyed by ``auth_user_id`` (the caller's own auth account), not by any
player of the caller's own -- a favorite must not require the caller to have a
linked player, and it must survive that player being re-linked or merged.

``(auth_user_id, player_id)`` is unique so favoriting twice is a no-op, not a
duplicate row; the ``ix_favorite_player_auth_user`` index backs the list query
(newest-first favorites for the current account).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "favplyr01"
down_revision: str | Sequence[str] | None = "enclogsrm1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "favorite_player",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auth_user_id", sa.BigInteger(), nullable=False),
        sa.Column("player_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["auth_user_id"], ["auth.user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["players.user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("auth_user_id", "player_id", name="uq_favorite_player_auth_user_player"),
        schema="players",
    )
    op.create_index(
        "ix_favorite_player_auth_user",
        "favorite_player",
        ["auth_user_id"],
        unique=False,
        schema="players",
    )
    op.create_index(
        op.f("ix_players_favorite_player_auth_user_id"),
        "favorite_player",
        ["auth_user_id"],
        unique=False,
        schema="players",
    )
    op.create_index(
        op.f("ix_players_favorite_player_player_id"),
        "favorite_player",
        ["player_id"],
        unique=False,
        schema="players",
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_players_favorite_player_player_id"), table_name="favorite_player", schema="players")
    op.drop_index(op.f("ix_players_favorite_player_auth_user_id"), table_name="favorite_player", schema="players")
    op.drop_index("ix_favorite_player_auth_user", table_name="favorite_player", schema="players")
    op.drop_table("favorite_player", schema="players")
