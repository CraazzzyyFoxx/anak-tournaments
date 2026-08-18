"""Add workspace.newcomer_scope and backfill Player.is_newcomer/is_newcomer_role chronologically.

Revision ID: ncscope01
Revises: matchsrc01
Create Date: 2026-08-18 00:00:00.000000

``Player.is_newcomer``/``is_newcomer_role`` were frozen at row-insert time by
checking "does this identity already have a Player row right now" -- order of
*import*, not order of *play*. Backfilling an older tournament after a newer
one is already imported freezes the newer rows wrong forever. This migration
adds the new per-workspace ``newcomer_scope`` setting (default ``'global'``,
matching today's accidental platform-wide behavior -- see
``shared.services.newcomer_status``) and recomputes every existing row using
``Tournament.start_date NULLS LAST, Tournament.id`` chronological order -- the
same convention ``division.py``/``streak.py``/``tournament/service.py`` already
use -- scoped per each row's own workspace setting.

Not reversible: a corrected row carries no marker distinguishing it from one
that was always right (same reasoning as ``matchsrc01``).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ncscope01"
down_revision: str | Sequence[str] | None = "matchsrc01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workspace",
        sa.Column("newcomer_scope", sa.String(16), nullable=False, server_default="global"),
    )
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT
                    p.id AS player_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY wm.player_id,
                                     CASE WHEN w.newcomer_scope = 'workspace' THEN t.workspace_id END
                        ORDER BY COALESCE(t.start_date, 'infinity'::timestamptz), t.id
                    ) AS overall_rank,
                    ROW_NUMBER() OVER (
                        PARTITION BY wm.player_id, p.role,
                                     CASE WHEN w.newcomer_scope = 'workspace' THEN t.workspace_id END
                        ORDER BY COALESCE(t.start_date, 'infinity'::timestamptz), t.id
                    ) AS role_rank
                FROM tournament.player p
                JOIN workspace_member wm ON wm.id = p.workspace_member_id
                JOIN tournament.tournament t ON t.id = p.tournament_id
                JOIN workspace w ON w.id = t.workspace_id
            )
            UPDATE tournament.player p
            SET is_newcomer = (ranked.overall_rank = 1),
                is_newcomer_role = (ranked.role_rank = 1)
            FROM ranked
            WHERE ranked.player_id = p.id
            """
        )
    )


def downgrade() -> None:
    # Not reversible -- see module docstring.
    op.drop_column("workspace", "newcomer_scope")
