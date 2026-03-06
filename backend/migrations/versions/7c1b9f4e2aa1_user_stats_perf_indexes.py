"""Add partial indexes for user statistics performance

Revision ID: 7c1b9f4e2aa1
Revises: 0d49e62b7a1f
Create Date: 2026-02-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c1b9f4e2aa1"
down_revision: str | None = "0d49e62b7a1f"
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
    bind = op.get_bind()
    index_defs = [
        (
            "ix_player_user_team_tournament_active",
            "CREATE INDEX CONCURRENTLY ix_player_user_team_tournament_active "
            "ON player (user_id, team_id, tournament_id) "
            "WHERE is_substitution IS FALSE",
        ),
        (
            "ix_match_statistics_playtime_match_user_hero",
            "CREATE INDEX CONCURRENTLY ix_match_statistics_playtime_match_user_hero "
            "ON match_statistics (match_id, user_id, hero_id) "
            "WHERE name = 'HeroTimePlayed' AND round = 0 AND value > 60",
        ),
        (
            "ix_match_statistics_user_hero_name_match_active",
            "CREATE INDEX CONCURRENTLY ix_match_statistics_user_hero_name_match_active "
            "ON match_statistics (user_id, hero_id, name, match_id) "
            "WHERE round = 0 AND hero_id IS NOT NULL",
        ),
        (
            "ix_match_statistics_team_user_round_name_nohero",
            "CREATE INDEX CONCURRENTLY ix_match_statistics_team_user_round_name_nohero "
            "ON match_statistics (team_id, user_id, round, name) "
            "WHERE hero_id IS NULL",
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
        "ix_match_statistics_team_user_round_name_nohero",
        "ix_match_statistics_user_hero_name_match_active",
        "ix_match_statistics_playtime_match_user_hero",
        "ix_player_user_team_tournament_active",
    ]:
        if not _index_exists(bind, index_name):
            continue
        with op.get_context().autocommit_block():
            op.execute(sa.text(f"DROP INDEX CONCURRENTLY {index_name}"))
