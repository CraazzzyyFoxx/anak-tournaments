"""Add ``tournament.tournament_link``.

Revision ID: tlink0001
Revises: pbledger01
Create Date: 2026-08-16 00:00:00.000000

A tournament had nowhere to put its external links, so organizers pasted the
Discord invite and the stream URL into the free-text description. Typed rows
replace that: several links per kind (two casters, one VOD per day), each with
its own label and ``sort_order``.

``kind`` is ``VARCHAR(32)``, not a PG enum -- the vocabulary lives in
``shared.models.tournament.link.TOURNAMENT_LINK_KINDS`` and is enforced by the
admin Pydantic schema, so adding a kind stays a code change. Same choice as
``tournament.tournament.team_formation``.

``is_active`` is a soft delete, which is why the uniqueness key is
``(tournament_id, kind, url)`` and not a partial index: re-adding a URL that was
deactivated must reuse the existing row rather than create a duplicate.

The ``tournament`` schema already exists from ``initial_v6``, so this revision
creates the table only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "tlink0001"
down_revision: str | Sequence[str] | None = "pbledger01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tournament_link",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournament.tournament.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "kind", "url", name="uq_tournament_link_tournament_kind_url"),
        schema="tournament",
    )
    op.create_index(
        "ix_tournament_link_tournament_active",
        "tournament_link",
        ["tournament_id", "is_active"],
        unique=False,
        schema="tournament",
    )
    op.create_index(
        op.f("ix_tournament_tournament_link_tournament_id"),
        "tournament_link",
        ["tournament_id"],
        unique=False,
        schema="tournament",
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_tournament_tournament_link_tournament_id"),
        table_name="tournament_link",
        schema="tournament",
    )
    op.drop_index("ix_tournament_link_tournament_active", table_name="tournament_link", schema="tournament")
    op.drop_table("tournament_link", schema="tournament")
