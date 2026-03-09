"""Enable pg_trgm + add trigram indexes for user search

Revision ID: 0d49e62b7a1f
Revises: 52a88c144ff9
Create Date: 2026-02-09 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d49e62b7a1f"
down_revision: str | None = "52a88c144ff9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _index_exists(bind: sa.engine.Connection, index_name: str) -> bool:
    row = bind.execute(
        sa.text(
            """
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = current_schema()
              AND indexname = :index_name
            """
        ),
        {"index_name": index_name},
    ).fetchone()
    return row is not None


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    bind = op.get_bind()
    index_defs = [
        (
            "ix_user_battle_tag_battle_tag_trgm",
            "CREATE INDEX CONCURRENTLY ix_user_battle_tag_battle_tag_trgm "
            "ON user_battle_tag USING gin (battle_tag gin_trgm_ops)",
        ),
        (
            "ix_user_battle_tag_name_trgm",
            "CREATE INDEX CONCURRENTLY ix_user_battle_tag_name_trgm ON user_battle_tag USING gin (name gin_trgm_ops)",
        ),
    ]

    for index_name, ddl in index_defs:
        if _index_exists(bind, index_name):
            continue
        with op.get_context().autocommit_block():
            op.execute(sa.text(ddl))


def downgrade() -> None:
    bind = op.get_bind()
    for index_name in [
        "ix_user_battle_tag_battle_tag_trgm",
        "ix_user_battle_tag_name_trgm",
    ]:
        if not _index_exists(bind, index_name):
            continue
        with op.get_context().autocommit_block():
            op.execute(sa.text(f"DROP INDEX CONCURRENTLY {index_name}"))

    # Intentionally keep pg_trgm extension; it may be used elsewhere.
